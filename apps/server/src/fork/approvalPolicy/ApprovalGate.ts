import type {
  OrchestrationV2Command,
  ServerSettingsError,
  OrchestrationV2TurnItem,
  ProviderApprovalDecision,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { annotateApproval } from "../decisions/points/riskAnnotation.ts";
import { type ApprovalFacts, evaluate, hasRules, type PolicyVerdict } from "./rules.ts";

type ApprovalItem = Extract<OrchestrationV2TurnItem, { readonly type: "approval_request" }>;
type Context = ProjectionStore.ProjectionRuntimeResponseContext;
type Denial = Extract<PolicyVerdict, { readonly decision: "deny" }>;

/** Request kinds a provider asks the user to approve; questions and auth refreshes are not. */
export const APPROVAL_KINDS: ReadonlySet<string> = new Set([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
]);

const PATH_KEYS = ["file_path", "path", "notebook_path", "filename", "fileName"];

const serialized = (input: unknown) =>
  input === undefined ? [] : [typeof input === "string" ? input : (JSON.stringify(input) ?? "")];

/** What the card, when stored, and the tool call it belongs to say the request would do. */
export const approvalFacts = (
  requestKind: string,
  item: ApprovalItem | undefined,
  tools: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot: string | undefined,
): ApprovalFacts => {
  const texts = item?.prompt === undefined ? [] : [item.prompt];
  const writePaths: Array<string> = [];
  let command: string | undefined;
  let toolName = item?.appName;
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
      if (requestKind === "file-change" && typeof tool.input === "object" && tool.input) {
        for (const key of PATH_KEYS) {
          const value: unknown = Reflect.get(tool.input, key);
          if (typeof value === "string") writePaths.push(value);
        }
      }
    }
  }
  // Without its tool call in the projection yet, a command card's prompt is the command.
  if (command === undefined && requestKind === "command") command = item?.prompt;
  return { toolName, command, texts, writePaths, workspaceRoot };
};

export const feedbackFor = (reason: string) =>
  `CMDeck's approval policy declined this request because ${reason}. The user set this rule; the request did not run. Do not try to reach the same result another way; continue without it or tell the user what you needed.`;

export const supportsFeedback = (request: Context["request"]) =>
  request?.responseCapability.type === "live" &&
  request.responseCapability.supportsFeedback === true;

const ACCEPTS: ReadonlySet<ProviderApprovalDecision | undefined> = new Set([
  "accept",
  "acceptForSession",
  "acceptAlways",
]);

interface Answer {
  readonly decision?: ProviderApprovalDecision | undefined;
  readonly feedback?: string | undefined;
}

/** What an answer to a judged request becomes. Declines and cancels pass unchanged. */
export const gateAnswer = (answer: Answer, verdict: PolicyVerdict, feedback: boolean): Answer => {
  if (!ACCEPTS.has(answer.decision)) return answer;
  if (verdict.decision === "deny") {
    return feedback
      ? { decision: "decline", feedback: feedbackFor(verdict.reason) }
      : { decision: "decline" };
  }
  // A standing grant lets the provider approve later requests itself, where the policy never sees them.
  return { ...answer, decision: "accept" };
};

export interface Judgement {
  readonly verdict: PolicyVerdict;
  readonly facts: ApprovalFacts;
}

export class ApprovalGate extends Context.Service<
  ApprovalGate,
  {
    /** The rules' verdict on a pending approval; null with no rules or nothing pending to judge. */
    readonly judge: (
      threadId: ThreadId,
      context: Context,
    ) => Effect.Effect<
      Judgement | null,
      ProjectionStore.ProjectionStoreV2Error | ServerSettingsError
    >;
    /** Annotates and audits a decline; returns the thread for callers that announce it. */
    readonly recordDecline: (input: {
      readonly threadId: ThreadId;
      readonly requestId: RuntimeRequestId;
      readonly requestKind: string;
      readonly verdict: Denial;
      readonly facts: ApprovalFacts;
      /** The accept the policy turned into this decline. */
      readonly overrode?: ProviderApprovalDecision | undefined;
    }) => Effect.Effect<{ readonly projectId: string | null; readonly title: string | null }>;
  }
>()("t3/fork/approvalPolicy/ApprovalGate") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const env = { home: yield* HostProcess.HomeDirectory, platform: yield* HostProcess.Platform };

  const judge = Effect.fn("ApprovalGate.judge")(function* (threadId: ThreadId, context: Context) {
    const rules = (yield* settings.getSettings).cmdeck.approvalPolicy;
    const { request, node, item, session } = context;
    if (!hasRules(rules) || request?.status !== "pending" || !APPROVAL_KINDS.has(request.kind)) {
      return null;
    }
    const tools =
      node?.parentNodeId == null
        ? []
        : (yield* projections.getThreadRecords(threadId, ["turnItems"], {
            turnItemNodeIds: [node.parentNodeId],
          })).turnItems;
    const card = item?.type === "approval_request" ? item : undefined;
    const facts = approvalFacts(request.kind, card, tools, session?.cwd);
    return { verdict: evaluate(rules, facts, env), facts };
  });

  const recordDecline: ApprovalGate["Service"]["recordDecline"] = Effect.fn(
    "ApprovalGate.recordDecline",
  )(function* (input) {
    const thread = yield* projections
      .findThread(input.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    const projectId = thread?.projectId ?? null;
    // Annotators run after the decision and only describe it.
    const { annotation } = yield* annotateApproval({
      request: {
        projectId,
        toolName: input.facts.toolName,
        command: input.facts.command,
        paths: input.facts.writePaths,
        workspaceRoot: input.facts.workspaceRoot,
        fileWrite: input.requestKind === "file-change",
      },
      policy: input.verdict,
    });
    yield* AuditLog.note({
      kind: "approval.policy_declined",
      actor: "policy",
      subject: input.threadId,
      detail: {
        requestId: input.requestId,
        requestKind: input.requestKind,
        rule: input.verdict.rule,
        reason: input.verdict.reason,
        risk: annotation.tier,
        overrode: input.overrode ?? null,
        projectId,
      },
    });
    return { projectId, title: thread?.title ?? null };
  });

  return ApprovalGate.of({ judge, recordDecline });
});

export const layer = Layer.effect(ApprovalGate, make);

type RespondCommand = Extract<OrchestrationV2Command, { readonly type: "runtime-request.respond" }>;

const withAnswer = (command: RespondCommand, answer: Answer): RespondCommand => {
  const { decision: _decision, feedback: _feedback, ...rest } = command;
  return {
    ...rest,
    ...(answer.decision === undefined ? {} : { decision: answer.decision }),
    ...(answer.feedback === undefined ? {} : { feedback: answer.feedback }),
  };
};

/**
 * The orchestrator's one call into the policy when an approval is answered: an accept the rules
 * deny becomes a decline. A runtime without the gate, such as an orchestration test, passes all.
 */
export const forRuntimeResponse = Effect.serviceOption(ApprovalGate).pipe(
  Effect.map(
    Option.match({
      onNone: () => (command: RespondCommand, _context: Context) => Effect.succeed(command),
      onSome: (gate) => (command: RespondCommand, context: Context) =>
        Effect.gen(function* () {
          if (!ACCEPTS.has(command.decision)) return command;
          const judgement = yield* gate.judge(command.threadId, context);
          if (judgement === null) return command;
          const { verdict, facts } = judgement;
          if (verdict.decision === "deny") {
            yield* gate.recordDecline({
              threadId: command.threadId,
              requestId: command.requestId,
              requestKind: context.request?.kind ?? "unknown",
              verdict,
              facts,
              overrode: command.decision,
            });
          }
          return withAnswer(
            command,
            gateAnswer(command, verdict, supportsFeedback(context.request)),
          );
        }).pipe(
          // An accept the policy cannot check is not let through.
          Effect.catchCause((cause) =>
            Effect.logWarning("The approval policy could not check an accept; declining it", {
              cause,
            }).pipe(Effect.as(withAnswer(command, { decision: "decline" }))),
          ),
        ),
    }),
  ),
);
