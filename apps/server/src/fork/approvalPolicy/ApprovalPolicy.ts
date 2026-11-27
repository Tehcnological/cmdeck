import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { annotateApproval } from "../decisions/points/riskAnnotation.ts";
import * as Notifications from "../notifications/Notifications.ts";
import {
  type ApprovalFacts,
  evaluate,
  hasRules,
  type PolicyEnvironment,
  type PolicyVerdict,
} from "./rules.ts";

type ApprovalItem = Extract<OrchestrationV2TurnItem, { readonly type: "approval_request" }>;

/** Request kinds a provider asks the user to approve; questions and auth refreshes are not. */
const APPROVAL_KINDS: ReadonlySet<string> = new Set([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
]);

const PATH_KEYS = ["file_path", "path", "notebook_path", "filename", "fileName"];

const serialized = (input: unknown) =>
  input === undefined ? [] : [typeof input === "string" ? input : (JSON.stringify(input) ?? "")];

/** What the card and the tool call it belongs to say the request would do. */
export const approvalFacts = (
  item: ApprovalItem,
  tools: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot: string | undefined,
): ApprovalFacts => {
  const texts = item.prompt === undefined ? [] : [item.prompt];
  const writePaths: Array<string> = [];
  let command: string | undefined;
  let toolName = item.appName;
  for (const tool of tools) {
    if (tool.type === "command_execution") {
      command = tool.input;
      texts.push(tool.input);
    } else if (tool.type === "file_change") {
      const paths = [
        tool.fileName,
        ...(tool.changes ?? []).flatMap((change) =>
          change.oldPath === undefined ? [change.path] : [change.path, change.oldPath],
        ),
      ];
      writePaths.push(...paths);
      texts.push(...paths);
    } else if (tool.type === "dynamic_tool") {
      toolName = tool.toolName ?? toolName;
      texts.push(...serialized(tool.input));
      if (item.requestKind === "file-change" && typeof tool.input === "object" && tool.input) {
        for (const key of PATH_KEYS) {
          const value: unknown = Reflect.get(tool.input, key);
          if (typeof value === "string") writePaths.push(value);
        }
      }
    }
  }
  // Without its tool call in the projection yet, a command card's prompt is the command.
  if (command === undefined && item.requestKind === "command") command = item.prompt;
  return { toolName, command, texts, writePaths, workspaceRoot };
};

/** The request a stored event shows waiting for an answer, if any. */
const pendingApprovalId = (event: OrchestrationV2DomainEvent): RuntimeRequestId | undefined => {
  if (event.type === "runtime-request.updated") {
    return event.payload.status === "pending" && APPROVAL_KINDS.has(event.payload.kind)
      ? event.payload.id
      : undefined;
  }
  if (event.type === "turn-item.updated" && event.payload.type === "approval_request") {
    return event.payload.status === "waiting" ? event.payload.requestId : undefined;
  }
  return undefined;
};

const feedbackFor = (reason: string) =>
  `CMDeck's approval policy declined this request because ${reason}. The user set this rule; the request did not run. Do not try to reach the same result another way; continue without it or tell the user what you needed.`;

export class ApprovalPolicy extends Context.Service<
  ApprovalPolicy,
  {
    /**
     * Checks one waiting approval against the deny rules and declines it when one applies.
     * Null when there is nothing to decide: no rules, a request already answered, or a card not
     * stored yet. Never fails; a request it cannot check stays with the user.
     */
    readonly screen: (
      threadId: ThreadId,
      requestId: RuntimeRequestId,
    ) => Effect.Effect<PolicyVerdict | null>;
  }
>()("t3/fork/approvalPolicy/ApprovalPolicy") {}

const make = Effect.fn("ApprovalPolicy.make")(function* (env: PolicyEnvironment) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const notifications = yield* Effect.serviceOption(Notifications.Notifications);

  const screen = Effect.fn("ApprovalPolicy.screen")(
    function* (threadId: ThreadId, requestId: RuntimeRequestId) {
      const rules = (yield* settings.getSettings).cmdeck.approvalPolicy;
      if (!hasRules(rules)) return null;
      const { request, node, item, session } = yield* projections.getRuntimeResponseContext(
        threadId,
        requestId,
      );
      if (
        request?.status !== "pending" ||
        !APPROVAL_KINDS.has(request.kind) ||
        item?.type !== "approval_request"
      ) {
        return null;
      }
      const tools =
        node?.parentNodeId == null
          ? []
          : (yield* projections.getThreadRecords(threadId, ["turnItems"], {
              turnItemNodeIds: [node.parentNodeId],
            })).turnItems;
      const facts = approvalFacts(item, tools, session?.cwd);
      const verdict = evaluate(rules, facts, env);
      if (verdict.decision === "allow") return verdict;

      const feedback =
        request.responseCapability.type === "live" &&
        request.responseCapability.supportsFeedback === true
          ? { feedback: feedbackFor(verdict.reason) }
          : {};
      yield* orchestrator.dispatch({
        type: "runtime-request.respond",
        commandId: CommandId.make(`approval-policy:${requestId}`),
        threadId,
        requestId,
        decision: "decline",
        ...feedback,
      });
      // The decline is sent; a failed lookup must not cost it its audit row.
      const thread = yield* projections.findThread(threadId).pipe(Effect.orElseSucceed(() => null));
      // Annotators run after the decision and only describe it.
      const { annotation } = yield* annotateApproval({
        request: {
          projectId: thread?.projectId ?? null,
          toolName: facts.toolName,
          command: facts.command,
          paths: facts.writePaths,
          workspaceRoot: facts.workspaceRoot,
          fileWrite: request.kind === "file-change",
        },
        policy: verdict,
      });
      yield* AuditLog.note({
        kind: "approval.policy_declined",
        actor: "policy",
        subject: threadId,
        detail: {
          requestId,
          requestKind: request.kind,
          rule: verdict.rule,
          reason: verdict.reason,
          risk: annotation.tier,
          projectId: thread?.projectId ?? null,
        },
      });
      if (Option.isSome(notifications)) {
        yield* notifications.value.alert({
          id: `approval-policy:${requestId}`,
          title: "Approval declined by policy",
          body: `${thread?.title ?? "A thread"}: declined because ${verdict.reason}.`,
          projectId: thread?.projectId,
          threadId,
        });
      }
      return verdict;
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("The approval policy could not check a request; it stays with the user", {
        cause,
      }).pipe(Effect.as(null)),
    ),
  );

  return ApprovalPolicy.of({ screen });
});

/** Screens every approval as soon as it is stored. */
export const layer = Layer.effect(
  ApprovalPolicy,
  Effect.gen(function* () {
    const policy = yield* make({
      home: yield* HostProcess.HomeDirectory,
      platform: yield* HostProcess.Platform,
    });
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        const requestId = pendingApprovalId(event);
        return requestId === undefined ? Effect.void : policy.screen(event.threadId, requestId);
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("approval policy stream failed", { cause })),
      ),
    );
    return policy;
  }),
);
