// The description follows Sillage's check_script tool text (MarlBurroW/sillage@14483e3
// apps/server/src/mcp/sillage-mcp.mjs, MIT), reworded for an explicit interpreter.
import {
  CHECK_SKIP_EXIT_CODE,
  CheckInterpreter,
  OrchestratorMcpFailure,
  ScheduledTaskCheck,
  ScheduledTaskId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as OrchestratorMcpService from "../../mcp/OrchestratorMcpService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { CheckScripts } from "./CheckScripts.ts";

const SetScheduledTaskCheckTool = Tool.make("set_scheduled_task_check", {
  description: `Gate a scheduled task with a check script so runs wake you only when there is work. Exit 0 runs with its stdout added to the prompt (or at \`{{check_output}}\`); exit ${CHECK_SKIP_EXIT_CODE} skips with no turn; other exits fail. Runs in the project folder; CMDECK_STATE_DIR persists between runs. Runs only once the user approves it: tell them. \`check: null\` removes it.`,
  parameters: Schema.Struct({
    scheduledTaskId: ScheduledTaskId,
    check: Schema.NullOr(ScheduledTaskCheck),
  }),
  success: Schema.Struct({
    scheduledTaskId: ScheduledTaskId,
    interpreter: Schema.optional(CheckInterpreter),
    needsApproval: Schema.Boolean,
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    OrchestratorMcpService.OrchestratorMcpService,
  ],
})
  .annotate(Tool.Title, "Set a scheduled task's check script")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const toolkit = Toolkit.make(SetScheduledTaskCheckTool);

// Agents propose; only a person approves (Settings > Scheduled tasks), so nothing here approves.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const checks = yield* CheckScripts;
    return {
      set_scheduled_task_check: McpToolAccess.writes(({ scheduledTaskId, check }) =>
        // A check gates runs at the task's modes, so changing it needs the limits editing the task does.
        Effect.flatMap(OrchestratorMcpService.OrchestratorMcpService, (service) =>
          Effect.flatMap(McpInvocationContext.McpInvocationContext, (scope) =>
            service.authorizeScheduledTaskChange(scope, scheduledTaskId),
          ),
        ).pipe(
          Effect.andThen(checks.set({ taskId: scheduledTaskId, check, by: "agent" })),
          Effect.map((state) => ({
            scheduledTaskId,
            ...(state === null ? {} : { interpreter: state.interpreter }),
            needsApproval: state !== null && !state.approved,
            message:
              state === null
                ? "Removed. The task's runs wake you as before."
                : state.approved
                  ? "Saved. These exact contents were already approved, so it runs as set."
                  : "Saved. It does not run until the user approves it in Settings > Scheduled tasks; until then each run fails with a note asking for approval.",
          })),
          Effect.catchTags({
            CheckScriptError: (error) =>
              Effect.fail(
                new OrchestratorMcpFailure({ code: "invalid_request", message: error.reason }),
              ),
          }),
        ),
      ),
    };
  }),
);

export const register = (registration: typeof toolkitRegistration) =>
  // The same instance upstream's orchestrator tools get: layers memoize by reference.
  registration(toolkit, layer).pipe(Layer.provide(OrchestratorMcpService.layer));
