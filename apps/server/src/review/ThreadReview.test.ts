import { assert, it } from "@effect/vitest";
import {
  CheckpointRef,
  CheckpointScopeId,
  type OrchestrationV2ServerCommand,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  THREAD_REVIEW_TAG,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ThreadReview from "./ThreadReview.ts";

const threadId = ThreadId.make("thread:review-parent");
const runId = RunId.make("run:review-parent:1");

const provider = (instanceId: string, driver: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-24T00:00:00.000Z",
  models: [{ slug: "reviewer-model", name: "Reviewer", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

function setup() {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const layer = ThreadReview.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
          getCheckpointContext: () =>
            Effect.succeed({
              runs: [{ id: runId, ordinal: 1, status: "completed" as const }],
              checkpointScopes: [],
              checkpoints: [
                {
                  scopeId: CheckpointScopeId.make("scope:review-parent"),
                  runId,
                  ordinalWithinScope: 1,
                  appRunOrdinal: 1,
                  status: "ready" as const,
                  ref: CheckpointRef.make("refs/t3/test/review"),
                },
              ],
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);
              return { sequence: dispatched.length, storedEvents: [] };
            }),
        }),
        Layer.mock(CheckpointDiffQuery.CheckpointDiffQuery)({
          getFullThreadDiff: (input) =>
            Effect.succeed({
              threadId: input.threadId,
              fromTurnCount: 0,
              toTurnCount: input.toTurnCount,
              diff: "diff --git a/a.ts b/a.ts\n+const answer = 41;",
            }),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([
            provider("claude-work", "claudeAgent"),
            provider("antigravity", "antigravity"),
          ]),
        }),
        SecureRandom.layerWebCrypto,
      ),
    ),
  );
  return { dispatched, layer };
}

it.effect("rejects an Antigravity reviewer before starting anything", () => {
  const { dispatched, layer } = setup();
  return Effect.gen(function* () {
    const review = yield* ThreadReview.ThreadReview;
    const error = yield* review
      .start({
        threadId,
        modelSelection: { instanceId: ProviderInstanceId.make("antigravity"), model: "gemini" },
        requestedBy: "user",
      })
      .pipe(Effect.flip);
    assert.strictEqual(error.reason, "reviewer_excluded");
    assert.deepEqual(dispatched, []);
  }).pipe(Effect.provide(layer));
});

it.effect("runs the chosen reviewer read-only on the thread's diff in a tagged side chat", () => {
  const { dispatched, layer } = setup();
  return Effect.gen(function* () {
    const review = yield* ThreadReview.ThreadReview;
    const modelSelection = {
      instanceId: ProviderInstanceId.make("claude-work"),
      model: "reviewer-model",
    };
    const { reviewThreadId } = yield* review.start({
      threadId,
      modelSelection,
      requestedBy: "user",
    });

    const fork = dispatched.find((command) => command.type === "thread.fork");
    assert.deepInclude(fork, { sourceThreadId: threadId, targetThreadId: reviewThreadId });
    assert.isTrue(fork?.type === "thread.fork" && fork.sideChat === true);
    assert.deepInclude(
      dispatched.find((command) => command.type === "thread.tag.set"),
      { threadId: reviewThreadId, tag: THREAD_REVIEW_TAG, tagged: true },
    );
    assert.deepInclude(
      dispatched.find((command) => command.type === "thread.runtime-mode.set"),
      { threadId: reviewThreadId, runtimeMode: "approval-required" },
    );
    const message = dispatched.find((command) => command.type === "message.dispatch");
    assert.isTrue(message?.type === "message.dispatch");
    if (message?.type !== "message.dispatch") return;
    assert.deepEqual(message.modelSelection, modelSelection);
    assert.strictEqual(message.threadId, reviewThreadId);
    assert.isTrue(message.freshContext);
    assert.include(message.text, "+const answer = 41;");
  }).pipe(Effect.provide(layer));
});

it.effect("refuses an unknown reviewer instead of falling back to another", () => {
  const { dispatched, layer } = setup();
  return Effect.gen(function* () {
    const review = yield* ThreadReview.ThreadReview;
    const error = yield* review
      .start({
        threadId,
        modelSelection: { instanceId: ProviderInstanceId.make("gone"), model: "reviewer-model" },
        requestedBy: "user",
      })
      .pipe(Effect.flip);
    assert.strictEqual(error.reason, "reviewer_unavailable");
    assert.deepEqual(dispatched, []);
  }).pipe(Effect.provide(layer));
});
