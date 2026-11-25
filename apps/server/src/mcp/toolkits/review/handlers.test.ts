import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
  ThreadReviewError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { DispatchModeLimit } from "../../../orchestration-v2/DispatchModeLimit.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadReview from "../../../review/ThreadReview.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as ReviewHandlers from "./handlers.ts";
import { ReviewToolkit } from "./tools.ts";

const CALLER = ThreadId.make("thread:review-caller");
const FULL_ACCESS_THREAD = ThreadId.make("thread:review-full-access");
const REVIEW_THREAD = ThreadId.make("review:started");

const threadScope = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["orchestration"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-review"),
  requestNamespace: "provider-session-review",
  thread: {
    threadId: CALLER,
    providerSessionId: "provider-session-review",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(capabilities),
  issuedAt: 0,
});

const readOnlyClientScope: McpInvocationContext.McpInvocationScope = {
  ...threadScope(),
  requestNamespace: "client:session-review",
  thread: undefined,
  client: { sessionId: "session-review", label: "Claude Code", access: "read-only" },
};

const makeHarness = Effect.fn("makeReviewToolkitHarness")(function* (options: {
  readonly callerMode: RuntimeMode;
  readonly fail?: ThreadReviewError;
}) {
  const started: Array<{
    readonly input: Parameters<ThreadReview.ThreadReview["Service"]["start"]>[0];
    readonly limit: RuntimeMode | undefined;
  }> = [];
  const shell = (id: ThreadId) =>
    McpToolAccessTestkit.liveThreadShell(id, {
      runtimeMode: id === CALLER ? options.callerMode : "full-access",
    });
  const layerDependencies = Layer.mergeAll(
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) => Effect.succeed(shell(id)),
      getProjectThreadRecords: (input) =>
        Effect.succeed(McpToolAccessTestkit.idleThreadProjection(shell(input.threadId))),
    }),
    Layer.mock(ThreadReview.ThreadReview)({
      start: (input) =>
        Effect.gen(function* () {
          started.push({ input, limit: (yield* DispatchModeLimit)?.runtimeMode });
          if (options.fail !== undefined) return yield* options.fail;
          return { reviewThreadId: REVIEW_THREAD };
        }),
    }),
  );
  const toolkit = yield* ReviewToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(ReviewHandlers.layer).pipe(
        Layer.provide(layerDependencies),
      ),
    ),
  );
  const call = (params: unknown, scope = threadScope()) =>
    toolkit.handle("t3_thread_review", params as never).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((chunk) => chunk.at(-1)!),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.provide(layerDependencies),
    );
  return { started, call };
});

describe("t3_thread_review", () => {
  it.effect("starts the review with exactly the reviewer the agent named", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ callerMode: "full-access" });
      const output = yield* harness.call({
        providerInstanceId: "antigravity",
        model: "gemini-3-pro",
        instructions: "Focus on the migration.",
      });
      expect(output.isFailure).toBe(false);
      expect(output.result).toMatchObject({ reviewThreadId: REVIEW_THREAD, status: "started" });
      expect(harness.started.map(({ input }) => input)).toEqual([
        {
          threadId: CALLER,
          modelSelection: {
            instanceId: ProviderInstanceId.make("antigravity"),
            model: "gemini-3-pro",
          },
          requestedBy: "agent",
          instructions: "Focus on the migration.",
        },
      ]);
    }),
  );

  it.effect("refuses a call that leaves out the reviewer's provider or model", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ callerMode: "full-access" });
      for (const params of [{ model: "gpt-6.1-sol" }, { providerInstanceId: "codex" }]) {
        const output = yield* harness.call(params);
        expect(output.isFailure).toBe(true);
        expect(output.result).toMatchObject({ _tag: "AiError" });
      }
      expect(harness.started).toEqual([]);
    }),
  );

  it.effect("refuses read-only clients and credentials that cannot control threads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ callerMode: "full-access" });
      const params = { providerInstanceId: "codex", model: "gpt-6.1-sol" };
      const readOnly = yield* harness.call({ ...params, threadId: CALLER }, readOnlyClientScope);
      expect(readOnly.result).toMatchObject({ code: "capability_denied" });
      const noOrchestration = yield* harness.call(params, threadScope([]));
      expect(noOrchestration.result).toMatchObject({ code: "capability_denied" });
      expect(harness.started).toEqual([]);
    }),
  );

  it.effect("keeps the review within the calling thread's runtime mode", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ callerMode: "approval-required" });
      const params = { providerInstanceId: "codex", model: "gpt-6.1-sol" };
      const above = yield* harness.call({ ...params, threadId: FULL_ACCESS_THREAD });
      expect(above.result).toMatchObject({ code: "runtime_mode_escalation_denied" });
      expect(harness.started).toEqual([]);

      yield* harness.call(params);
      expect(harness.started.map(({ limit }) => limit)).toEqual(["approval-required"]);
    }),
  );

  it.effect("reports why the review could not start", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        callerMode: "full-access",
        fail: new ThreadReviewError({ reason: "reviewer_unavailable", message: "Gone." }),
      });
      const output = yield* harness.call({ providerInstanceId: "gone", model: "x" });
      expect(output.isFailure).toBe(true);
      expect(output.result).toMatchObject({ code: "provider_unavailable", message: "Gone." });
    }),
  );
});
