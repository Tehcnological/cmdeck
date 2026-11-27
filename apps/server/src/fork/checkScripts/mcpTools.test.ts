import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import { CheckScripts } from "./CheckScripts.ts";
import { layerOrchestratorMcpStubs } from "./checkScripts.testkit.ts";

const taskId = ScheduledTaskId.make("scheduled-task:full");
const narrowCaller = ThreadId.make("thread:approval-required");
const equalCaller = ThreadId.make("thread:full-access");
const shellOf = (threadId: ThreadId) =>
  liveThreadShell(threadId, {
    runtimeMode: threadId === narrowCaller ? "approval-required" : "full-access",
  });

const calls: Array<{ readonly taskId: string; readonly removed: boolean }> = [];

const layer = ForkMcpToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(shellOf(threadId)),
      getThreadRecords: (threadId) => Effect.succeed(idleThreadProjection(shellOf(threadId))),
    }),
  ),
  Layer.provide(
    layerOrchestratorMcpStubs({
      list: () =>
        Effect.succeed({
          tasks: [
            {
              id: taskId,
              projectId: ProjectId.make("project:mcp-test"),
              runtimeMode: "full-access",
              interactionMode: "default",
              threadId: null,
            } as never,
          ],
        }),
    }),
  ),
  Layer.provide(
    Layer.succeed(CheckScripts, {
      ...CheckScripts.defaultValue(),
      set: (input) =>
        Effect.sync(() => {
          calls.push({ taskId: input.taskId, removed: input.check === null });
          return null;
        }),
    }),
  ),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "check-scripts-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "check-scripts-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const callAs = (threadId: ThreadId, check: unknown) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) =>
      server.callTool({
        name: "set_scheduled_task_check",
        arguments: { scheduledTaskId: taskId, check },
      }),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-check-scripts-test"),
      requestNamespace: "provider-session-check-scripts-test",
      thread: {
        threadId,
        providerSessionId: "provider-session-check-scripts-test",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 1,
    }),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

it.layer(layer)((it) => {
  it.effect("changing a task's check needs the limits editing the task does", () =>
    Effect.gen(function* () {
      const script = { interpreter: "bash", script: "exit 10" };

      // An approval-required agent may neither add nor remove the gate on a full-access task.
      for (const check of [script, null]) {
        const refused = yield* callAs(narrowCaller, check);
        expect(refused.isError).toBe(true);
        expect(JSON.stringify(refused.content)).toContain("runtime_mode_escalation_denied");
      }
      expect(calls).toEqual([]);

      for (const check of [script, null]) {
        expect((yield* callAs(equalCaller, check)).isError).toBeFalsy();
      }
      expect(calls).toEqual([
        { taskId, removed: false },
        { taskId, removed: true },
      ]);
    }),
  );
});
