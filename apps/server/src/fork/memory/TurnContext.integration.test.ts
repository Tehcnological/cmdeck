import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
} from "@t3tools/contracts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as MemoryStore from "./MemoryStore.ts";
import { layerMemoryTest, threads } from "./memory.testkit.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex-memory-test");
const modelSelection = { instanceId, model: "memory-model" };

/** Completes every turn at once and keeps the text each one sent the provider. */
const capturingAdapter = (
  sent: Ref.Ref<ReadonlyArray<string>>,
): ProviderAdapter.ProviderAdapterV2["Service"] => ({
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" } as const),
  openSession: (sessionInput) =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
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
            yield* Ref.update(sent, (texts) => [...texts, input.message.text]);
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
          }),
        steerTurn: () => Effect.void,
        interruptTurn: () => Effect.void,
        respondToRuntimeRequest: () => Effect.void,
        readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
        rollbackThread: () => Effect.die("unused rollbackThread"),
        forkThread: () => Effect.die("unused forkThread"),
      };
    }),
});

it.live("puts memory in the provider input, never in the stored message", () =>
  Effect.gen(function* () {
    const cwd = yield* checkpointWorkspace("memory-turn-context");
    const thread = threads.main;
    const sent = yield* Ref.make<ReadonlyArray<string>>([]);
    const store = yield* MemoryStore.MemoryStore;
    const context = yield* store.threadContext(thread);
    yield* store.remember({
      context,
      scope: "project:project-app",
      kind: "rule",
      content: "Use pnpm, not npm",
      actor: "user",
    });
    // No turn has started, so an agent's write waits for the user.
    const proposal = yield* store.remember({
      context,
      scope: "project:project-app",
      kind: "rule",
      content: "Run the linter before committing",
      actor: "agent",
    });
    assert.equal(proposal.status, "pending");

    const projection = yield* Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const eventSink = yield* EventSink.EventSinkV2;
      yield* orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("command:memory:create"),
        threadId: thread.id,
        projectId: thread.projectId,
        title: "Memory",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: cwd,
      });
      const send = Effect.fn("send")(function* (key: string, text: string) {
        const completed = yield* eventSink
          .stream({
            threadId: thread.id,
            afterSequence: yield* eventSink.latestSequence({ threadId: thread.id }),
          })
          .pipe(
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
          commandId: CommandId.make(`command:memory:${key}`),
          threadId: thread.id,
          messageId: MessageId.make(`message:memory:${key}`),
          text,
          attachments: [],
          modelSelection,
          dispatchMode: { type: "start_immediately" },
        });
        yield* Fiber.join(completed);
        yield* worker.drain();
      });

      yield* send("first", "Set up the project");
      yield* store.accept(proposal.id);
      yield* send("second", "Now commit it");
      return yield* orchestrator.getThreadProjection(thread.id);
    }).pipe(
      Effect.provide(
        ProviderReplayHarness.layerWithRegistry(
          { name: "memory-turn-context" },
          ProviderAdapterRegistry.layerSingle(capturingAdapter(sent)),
        ),
      ),
    );

    const [first, second] = yield* Ref.get(sent);
    assert.include(first, "<cmdeck_context>");
    assert.include(first, "Use pnpm, not npm");
    assert.notInclude(first, "Run the linter before committing");
    assert.include(first, "Set up the project");
    assert.include(second, "Run the linter before committing");

    const userTexts = projection.turnItems.flatMap((item) =>
      item.type === "user_message" ? [item.text] : [],
    );
    assert.deepEqual(userTexts, ["Set up the project", "Now commit it"]);
    assert.notInclude(JSON.stringify(projection), "cmdeck_context");
  }).pipe(Effect.scoped, Effect.provide(layerMemoryTest({ memoryEnabled: true }))),
);
