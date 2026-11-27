import { assert, it } from "@effect/vitest";
import {
  type ApprovalPolicyRules,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  MessageId,
  NodeId,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  ProjectId,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { makeManagedSettings } from "../../policy/managedSettings.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as ApprovalGate from "./ApprovalGate.ts";
import * as ApprovalPolicy from "./ApprovalPolicy.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-approval-policy");
const modelSelection = { instanceId, model: "policy-model" };
const threadId = ThreadId.make("thread-approval-policy");
const projectId = ProjectId.make("project-approval-policy");
const requestId = RuntimeRequestId.make("request:canary");
/** Read as text only; no test opens it. */
const CANARY_READ = "cat ~/.aws/credentials";

interface Response {
  readonly decision: string | undefined;
  readonly feedback: string | undefined;
}

/**
 * Each turn runs one shell command that needs approval and finishes once it is answered. The card
 * calls the command harmless, as an agent might; only the command itself reads the canary file.
 */
const approvalAdapter = (
  responses: Ref.Ref<ReadonlyArray<Response>>,
): ProviderAdapter.ProviderAdapterV2["Service"] => ({
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" } as const),
  openSession: (sessionInput) =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
      const turns = yield* Ref.make<
        ReadonlyArray<{ readonly input: ProviderAdapter.ProviderAdapterV2TurnInput }>
      >([]);
      const now = yield* DateTime.now;
      const providerSession: OrchestrationV2ProviderSession = {
        id: sessionInput.providerSessionId,
        driver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: sessionInput.runtimePolicy.cwd ?? "/fallback",
        model: sessionInput.modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const finish = (input: ProviderAdapter.ProviderAdapterV2TurnInput) =>
        Effect.gen(function* () {
          const providerTurnId = ProviderTurnId.make(`provider-turn:${input.attemptId}`);
          const occurredAt = yield* DateTime.now;
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver,
            providerTurn: {
              id: providerTurnId,
              providerThreadId: input.providerThread.id,
              nodeId: input.rootNodeId,
              runAttemptId: input.attemptId,
              nativeTurnRef: { driver, nativeId: `native:${providerTurnId}`, strength: "strong" },
              ordinal: input.providerTurnOrdinal,
              status: "completed",
              startedAt: occurredAt,
              completedAt: occurredAt,
            },
          });
          yield* Queue.offer(events, {
            type: "turn.terminal",
            driver,
            providerThreadId: input.providerThread.id,
            providerTurnId,
            runOrdinal: input.runOrdinal,
            status: "completed",
            failure: null,
            threadDisposition: "reusable",
          });
        });
      return {
        instanceId,
        driver,
        providerSessionId: sessionInput.providerSessionId,
        providerSession,
        events: Stream.fromQueue(events),
        ensureThread: (threadInput) =>
          Effect.gen(function* () {
            const createdAt = yield* DateTime.now;
            return {
              id: ProviderThreadId.make(`provider-thread:${threadInput.threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: sessionInput.providerSessionId,
              appThreadId: threadInput.threadId,
              ownerNodeId: null,
              nativeThreadRef: {
                driver,
                nativeId: `native-thread:${threadInput.threadId}`,
                strength: "strong",
              },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt,
              updatedAt: createdAt,
            } satisfies OrchestrationV2ProviderThread;
          }),
        resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
        startTurn: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(turns, (current) => [...current, { input }]);
            const providerTurnId = ProviderTurnId.make(`provider-turn:${input.attemptId}`);
            const at = yield* DateTime.now;
            const toolNodeId = NodeId.make("node:tool:canary");
            const approvalNodeId = NodeId.make("node:approval:canary");
            const nativeItemRef = {
              driver,
              nativeId: "native:canary",
              strength: "strong" as const,
            };
            const base = {
              threadId: input.threadId,
              runId: input.runId,
              providerThreadId: input.providerThread.id,
              providerTurnId,
              nativeItemRef,
              rootNodeId: input.rootNodeId,
            };
            const node = (id: NodeId, kind: "tool_call" | "approval_request") => ({
              ...base,
              id,
              parentNodeId: kind === "tool_call" ? input.rootNodeId : toolNodeId,
              kind,
              status: kind === "tool_call" ? ("running" as const) : ("waiting" as const),
              countsForRun: kind === "tool_call",
              runtimeRequestId: kind === "tool_call" ? null : requestId,
              checkpointScopeId: null,
              startedAt: at,
              completedAt: null,
            });
            const item = {
              threadId: input.threadId,
              runId: input.runId,
              providerThreadId: input.providerThread.id,
              providerTurnId,
              nativeItemRef,
              parentItemId: null,
              title: null,
              startedAt: at,
              completedAt: null,
              updatedAt: at,
            };
            yield* Queue.offerAll(events, [
              {
                type: "provider_turn.updated",
                driver,
                providerTurn: {
                  id: providerTurnId,
                  providerThreadId: input.providerThread.id,
                  nodeId: input.rootNodeId,
                  runAttemptId: input.attemptId,
                  nativeTurnRef: {
                    driver,
                    nativeId: `native:${providerTurnId}`,
                    strength: "strong",
                  },
                  ordinal: input.providerTurnOrdinal,
                  status: "running",
                  startedAt: at,
                  completedAt: null,
                },
              },
              { type: "node.updated", driver, node: node(toolNodeId, "tool_call") },
              {
                type: "turn_item.updated",
                driver,
                turnItem: {
                  ...item,
                  id: TurnItemId.make("item:tool:canary"),
                  nodeId: toolNodeId,
                  ordinal: 1,
                  status: "running",
                  type: "command_execution",
                  input: CANARY_READ,
                },
              },
              { type: "node.updated", driver, node: node(approvalNodeId, "approval_request") },
              {
                type: "runtime_request.updated",
                driver,
                runtimeRequest: {
                  id: requestId,
                  nodeId: approvalNodeId,
                  providerTurnId,
                  nativeRequestRef: { driver, nativeId: "native:request", strength: "strong" },
                  kind: "command",
                  status: "pending",
                  responseCapability: {
                    type: "live",
                    providerSessionId: sessionInput.providerSessionId,
                    supportsFeedback: true,
                  },
                  createdAt: at,
                  resolvedAt: null,
                },
              },
              {
                type: "turn_item.updated",
                driver,
                turnItem: {
                  ...item,
                  id: TurnItemId.make("item:approval:canary"),
                  nodeId: approvalNodeId,
                  ordinal: 2,
                  status: "waiting",
                  type: "approval_request",
                  requestId,
                  requestKind: "command",
                  prompt: "Check the project README for setup steps",
                },
              },
            ]);
          }),
        steerTurn: () => Effect.void,
        interruptTurn: () => Effect.void,
        respondToRuntimeRequest: (response) =>
          Effect.gen(function* () {
            yield* Ref.update(responses, (current) => [
              ...current,
              { decision: response.decision, feedback: response.feedback },
            ]);
            const [turn] = yield* Ref.get(turns);
            if (turn !== undefined) yield* finish(turn.input);
          }),
        readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
        rollbackThread: () => Effect.die("unused rollbackThread"),
        forkThread: () => Effect.die("unused forkThread"),
      };
    }),
});

/**
 * The orchestration runtime with the gate beneath it, as in the server, on one database. Without
 * `subscriber`, nothing screens a request until someone answers it.
 */
const runtime = (input: {
  readonly name: string;
  readonly responses: Ref.Ref<ReadonlyArray<Response>>;
  readonly audited: Ref.Ref<ReadonlyArray<AuditLog.AuditEventInput>>;
  readonly approvalPolicy: Partial<ApprovalPolicyRules>;
  readonly subscriber: boolean;
}) => {
  const database = SqlitePersistence.layerMemory;
  const projections = ProjectionStore.layer.pipe(Layer.provide(database));
  const gate = ApprovalGate.layer.pipe(
    Layer.provide(projections),
    Layer.provide(ServerSettings.layerTest({ cmdeck: { approvalPolicy: input.approvalPolicy } })),
  );
  const base = Layer.mergeAll(
    ProviderReplayHarness.layerWithRegistry(
      { name: input.name },
      ProviderAdapterRegistry.layerSingle(approvalAdapter(input.responses)),
      { databaseLayer: database },
    ).pipe(Layer.provideMerge(gate)),
    projections,
    Layer.mock(AuditLog.AuditLog)({
      append: (event) => Ref.update(input.audited, (current) => [...current, event]),
    }),
  );
  return input.subscriber ? ApprovalPolicy.layer.pipe(Layer.provideMerge(base)) : base;
};

const startThread = Effect.fn("startThread")(function* (cwd: string) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const eventSink = yield* EventSink.EventSinkV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make("command:policy:create"),
    threadId,
    projectId,
    title: "Policy",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: cwd,
  });
  const after = { threadId, afterSequence: yield* eventSink.latestSequence({ threadId }) };
  const pending = yield* eventSink.stream(after).pipe(
    Stream.filter(
      ({ event }) =>
        event.type === "turn-item.updated" &&
        event.payload.type === "approval_request" &&
        event.payload.status === "waiting",
    ),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped,
  );
  const completed = yield* eventSink.stream(after).pipe(
    Stream.filter(
      ({ event }) => event.type === "run.updated" && event.payload.status === "completed",
    ),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped,
  );
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make("command:policy:message"),
    threadId,
    messageId: MessageId.make("message:policy"),
    text: "Set up the project",
    attachments: [],
    modelSelection,
    dispatchMode: { type: "start_immediately" },
  });
  return { pending, completed };
});

const run = Effect.fn("run")(function* (
  name: string,
  approvalPolicy: Partial<ApprovalPolicyRules>,
  options: { readonly subscriber: boolean; readonly accept?: ProviderApprovalDecision },
) {
  const cwd = yield* checkpointWorkspace(name);
  const responses = yield* Ref.make<ReadonlyArray<Response>>([]);
  const audited = yield* Ref.make<ReadonlyArray<AuditLog.AuditEventInput>>([]);
  const projection = yield* Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const { pending, completed } = yield* startThread(cwd);
    if (options.accept !== undefined) {
      yield* Fiber.join(pending);
      yield* orchestrator.dispatch({
        type: "runtime-request.respond",
        commandId: CommandId.make("command:policy:answer"),
        threadId,
        requestId,
        decision: options.accept,
      });
    }
    yield* Fiber.join(completed);
    yield* (yield* EffectWorker.OrchestrationEffectWorkerV2).drain();
    return yield* orchestrator.getThreadProjection(threadId);
  }).pipe(
    Effect.provide(
      runtime({ name, responses, audited, approvalPolicy, subscriber: options.subscriber }),
    ),
  );
  const declines = (yield* Ref.get(audited)).filter(
    (event) => event.kind === "approval.policy_declined",
  );
  return {
    responses: yield* Ref.get(responses),
    declines,
    request: projection.runtimeRequests.find((candidate) => candidate.id === requestId),
  };
});

const credentialFloor = { protectedPaths: ["~/.aws"] };

it.live("declines a protected read nobody answers, with the reason", () =>
  Effect.gen(function* () {
    const { responses, declines, request } = yield* run("approval-policy-deny", credentialFloor, {
      subscriber: true,
    });
    const [response, ...rest] = responses;
    assert.deepEqual(rest, []);
    assert.equal(response?.decision, "decline");
    assert.include(response?.feedback ?? "", "it touches the protected path ~/.aws");
    assert.equal(request?.status, "resolved");
    assert.equal(request?.decision, "decline");
    const [entry] = declines;
    assert.equal(entry?.actor, "policy");
    assert.equal(entry?.subject, threadId);
    assert.equal(entry?.detail?.rule, "protectedPaths: ~/.aws");
    assert.equal(entry?.detail?.overrode, null);
    // The annotation ran after the decision and left it alone.
    assert.equal(entry?.detail?.risk, "risky");
  }).pipe(Effect.scoped),
);

it.live("turns an accept that arrives before the screen into a decline with the reason", () =>
  Effect.gen(function* () {
    const { responses, declines, request } = yield* run("approval-policy-race", credentialFloor, {
      subscriber: false,
      accept: "acceptForSession",
    });
    assert.equal(responses.length, 1);
    assert.equal(responses[0]?.decision, "decline");
    assert.include(responses[0]?.feedback ?? "", "it touches the protected path ~/.aws");
    assert.equal(request?.decision, "decline");
    assert.equal(declines[0]?.detail?.overrode, "acceptForSession");
  }).pipe(Effect.scoped),
);

it.live("an accept cannot override a rule a managed policy locks", () =>
  Effect.gen(function* () {
    const managed = makeManagedSettings({
      "cmdeck.approvalPolicy.protectedPaths": { value: ["~/.aws"], locked: true },
    });
    if (managed._tag !== "Valid") return yield* Effect.die(managed.reason);
    // The user's own settings say nothing; the lock alone carries the rule.
    const locked = managed.settings.applyLocks(DEFAULT_SERVER_SETTINGS).cmdeck.approvalPolicy;
    const { responses, declines } = yield* run("approval-policy-locked", locked, {
      subscriber: false,
      accept: "accept",
    });
    assert.deepEqual(
      responses.map((response) => response.decision),
      ["decline"],
    );
    assert.equal(declines[0]?.detail?.rule, "protectedPaths: ~/.aws");
  }).pipe(Effect.scoped),
);

it.live("with no rules, an accept passes unchanged and nothing screens the request", () =>
  Effect.gen(function* () {
    const { responses, declines, request } = yield* run(
      "approval-policy-none",
      {},
      { subscriber: true, accept: "acceptForSession" },
    );
    assert.deepEqual(responses, [{ decision: "acceptForSession", feedback: undefined }]);
    assert.equal(request?.decision, "acceptForSession");
    assert.deepEqual(declines, []);
  }).pipe(Effect.scoped),
);
