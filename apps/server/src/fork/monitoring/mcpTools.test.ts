import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { layerOrchestratorMcpStubs } from "../checkScripts/checkScripts.testkit.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import { MonitorLoops } from "./MonitorLoops.ts";

const PROJECT = ProjectId.make("project:mcp-test");
const RUN = RunId.make("run:mcp-test");
const userTurn = ThreadId.make("thread:user-turn");
const scheduledTurn = ThreadId.make("thread:scheduled-turn");
const narrowCaller = ThreadId.make("thread:approval-required");
const otherThread = ThreadId.make("thread:other");
const loopTask = ScheduledTaskId.make("scheduled-task:loop");
const plainTask = ScheduledTaskId.make("scheduled-task:plain");

const shellOf = (threadId: ThreadId) =>
  liveThreadShell(threadId, {
    runtimeMode: threadId === narrowCaller ? "approval-required" : "full-access",
  });

const upserts: Array<ScheduledTaskUpsertInput> = [];
const armed: Array<{
  readonly threadId: string;
  readonly mode: string;
  readonly maxCycles: number;
}> = [];
const stopped: Array<string> = [];
const quiet: Array<{ readonly threadId: string; readonly runId: string }> = [];

const storedTask = (input: Partial<ScheduledTaskUpsertInput> & { readonly id: ScheduledTaskId }) =>
  ({
    title: "Monitor: CI",
    prompt: "Check CI.",
    enabled: true,
    schedule: { type: "interval", everyMs: 300_000 },
    projectId: PROJECT,
    threadId: null,
    threadMode: "continue",
    runtimeMode: "full-access",
    interactionMode: "default",
    nextRunAt: null,
    lastRunStatus: "never",
    ...input,
  }) as never;

const layer = ForkMcpToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(shellOf(threadId)),
      getThreadRecords: (threadId) =>
        Effect.succeed({
          ...idleThreadProjection(shellOf(threadId)),
          runs: [{ id: RUN, status: "running", userMessageId: MessageId.make("msg:prompt") }],
        } as never),
      getMessagesById: (threadId, ids) =>
        Effect.succeed(
          new Map(
            ids.map((id) => [
              id,
              (threadId === scheduledTurn
                ? { createdBy: "user", scheduledTaskId: plainTask }
                : { createdBy: "user" }) as never,
            ]),
          ),
        ),
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectService.ProjectService)({
      getById: (id) => Effect.succeedSome({ id, workspaceRoot: "/home/user/app" } as never),
    }),
  ),
  Layer.provide(
    layerOrchestratorMcpStubs({
      upsert: (input) =>
        Effect.sync(() => {
          upserts.push(input);
          return { task: storedTask({ ...input, id: loopTask }) };
        }),
      list: () =>
        Effect.succeed({
          tasks: [
            storedTask({ id: loopTask, threadId: otherThread }),
            storedTask({ id: plainTask, threadId: otherThread }),
          ],
        }),
    }),
  ),
  Layer.provide(
    Layer.succeed(MonitorLoops, {
      arm: (input) =>
        Effect.sync(() => {
          armed.push({ threadId: input.threadId, mode: input.mode, maxCycles: input.maxCycles });
          return { ...input, scheduledTaskId: input.taskId, cycles: 0 };
        }),
      loopsOn: () => Effect.succeed([]),
      loop: (taskId) =>
        Effect.succeed(
          taskId === loopTask
            ? {
                scheduledTaskId: loopTask,
                threadId: otherThread,
                mode: "interval" as const,
                cycles: 0,
                maxCycles: 10,
                expiresAt: 0,
              }
            : undefined,
        ),
      stop: (taskId) => Effect.sync(() => void stopped.push(taskId)),
      markQuiet: (input) => Effect.sync(() => void quiet.push(input)),
      settled: () => Effect.void,
    }),
  ),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "monitoring-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "monitoring-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const callAs = (threadId: ThreadId, name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-monitoring-test"),
      requestNamespace: "provider-session-monitoring-test",
      thread: {
        threadId,
        providerSessionId: "provider-session-monitoring-test",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 1,
    }),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

it.layer(layer)((it) => {
  it.effect("nothing_to_report is refused on a turn the user started", () =>
    Effect.gen(function* () {
      const refused = yield* callAs(userTurn, "nothing_to_report", { note: "No change." });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("the user started this turn");
      expect(quiet).toEqual([]);

      expect((yield* callAs(scheduledTurn, "nothing_to_report", {})).isError).toBeFalsy();
      expect(quiet).toEqual([{ threadId: scheduledTurn, runId: RUN, note: undefined }]);
    }),
  );

  it.effect("monitor_start binds the loop to the caller's thread at the caller's own modes", () =>
    Effect.gen(function* () {
      const result = yield* callAs(narrowCaller, "monitor_start", {
        prompt: "Check whether CI on acme/app is green.",
        mode: "idle",
        minutes: 5,
      });
      expect(result.isError).toBeFalsy();
      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toMatchObject({
        threadId: narrowCaller,
        threadMode: "continue",
        runtimeMode: "approval-required",
        interactionMode: "default",
        schedule: { type: "interval", everyMs: 300_000 },
        title: "Monitor: Check whether CI on acme/app is green.",
      });
      expect(armed).toEqual([{ threadId: narrowCaller, mode: "idle", maxCycles: 10 }]);
    }),
  );

  it.effect("monitor_stop ends only loops, and another thread's loop needs its limits", () =>
    Effect.gen(function* () {
      const notLoop = yield* callAs(narrowCaller, "monitor_stop", { scheduledTaskId: plainTask });
      expect(JSON.stringify(notLoop.content)).toContain("task_not_found");

      const narrow = yield* callAs(narrowCaller, "monitor_stop", { scheduledTaskId: loopTask });
      expect(JSON.stringify(narrow.content)).toContain("runtime_mode_escalation_denied");
      expect(stopped).toEqual([]);

      expect(
        (yield* callAs(userTurn, "monitor_stop", { scheduledTaskId: loopTask })).isError,
      ).toBeFalsy();
      expect(stopped).toEqual([loopTask]);
    }),
  );
});
