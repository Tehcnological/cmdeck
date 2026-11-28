// nothing_to_report's description follows Kiro Crew's nothing_to_do tool
// (KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/mcp_tools/control_parts/schemas.py,
// Apache-2.0), shortened and limited to automated turns.
import { OrchestratorMcpFailure, ScheduledTaskId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as OrchestratorMcpService from "../../mcp/OrchestratorMcpService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { SENTINEL_PATTERN } from "./decide.ts";
import { MonitorLoops } from "./MonitorLoops.ts";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_CYCLES = 10;
const DEFAULT_EXPIRES_IN_HOURS = 24;

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    OrchestratorMcpService.OrchestratorMcpService,
  ],
};

const MonitorStartTool = Tool.make("monitor_start", {
  ...shared,
  description:
    "Wake this thread repeatedly to check on something, as a loop: `interval` wakes every `minutes`; `idle` wakes once the thread has been quiet `minutes` (any turn restarts the wait). Each wake sends `prompt` here. It ends after maxCycles wakes, at expiresInHours, when you reply with stopSentinel, on monitor_stop, or if the thread is archived. A busy thread skips a wake. To wake only on change, give the task a check (set_scheduled_task_check): unchanged output skips.",
  parameters: Schema.Struct({
    prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)).annotate({
      description: "What each wake should check and do.",
    }),
    mode: Schema.Literals(["interval", "idle"]),
    minutes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1440 })),
    maxCycles: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
    ).annotate({
      description: `Wakes before it ends. Default ${DEFAULT_MAX_CYCLES}.`,
    }),
    expiresInHours: Schema.optional(
      Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 168 })),
    ).annotate({ description: `Default ${DEFAULT_EXPIRES_IN_HOURS}.` }),
    stopSentinel: Schema.optional(Schema.String.check(Schema.isPattern(SENTINEL_PATTERN))).annotate(
      { description: "A word such as MONITOR_DONE; a reply line holding only it ends the loop." },
    ),
    title: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80))),
  }),
  success: Schema.Struct({
    scheduledTaskId: ScheduledTaskId,
    expiresAt: Schema.String,
    maxCycles: Schema.Int,
    message: Schema.String,
  }),
})
  .annotate(Tool.Title, "Start a monitor loop")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const MonitorStopTool = Tool.make("monitor_stop", {
  ...shared,
  description: "End monitor loops. Default: every loop on this thread.",
  parameters: Schema.Struct({
    scheduledTaskId: Schema.optional(ScheduledTaskId).annotate({
      description: "One loop, from monitor_start.",
    }),
  }),
  success: Schema.Struct({ stopped: Schema.Array(ScheduledTaskId), message: Schema.String }),
})
  .annotate(Tool.Title, "Stop a monitor loop")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const NothingToReportTool = Tool.make("nothing_to_report", {
  ...shared,
  description:
    "Close an automated turn (scheduled task, monitor loop or event wake) that found nothing the user needs: the run shows as checked with nothing to report and notifies no one. Refused on a turn the user started. Never use it to skip a question or unfinished work. After it, end the turn with at most one short line. The note is kept with the run, not sent.",
  parameters: Schema.Struct({
    note: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  }),
  success: Schema.Struct({ message: Schema.String }),
})
  .annotate(Tool.Title, "Nothing to report")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const toolkit = Toolkit.make(MonitorStartTool, MonitorStopTool, NothingToReportTool);

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

const callerThread = (operation: string) =>
  McpInvocationContext.McpInvocationContext.pipe(
    Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, operation)),
  );

// Built with the server's context: a runtime without MonitorLoops (a tool-list test) refuses calls.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const service = yield* Effect.serviceOption(MonitorLoops);
    const withLoops = <A, R>(
      use: (loops: MonitorLoops["Service"]) => Effect.Effect<A, OrchestratorMcpFailure, R>,
    ) =>
      Option.match(service, {
        onNone: () =>
          Effect.fail(failure("capability_denied", "Monitor loops are not available here.")),
        onSome: use,
      });

    return {
      monitor_start: McpToolAccess.actsAsCaller((input) =>
        withLoops((loops) =>
          Effect.gen(function* () {
            const scope = yield* McpInvocationContext.McpInvocationContext;
            const { thread } = yield* callerThread("monitor_start");
            const orchestrator = yield* OrchestratorMcpService.OrchestratorMcpService;
            const firstLine = input.prompt.trim().split("\n")[0]!.slice(0, 70);
            // Bound to this thread in `continue` mode, at this thread's own modes.
            const task = yield* orchestrator.scheduleTask(scope, {
              prompt: input.prompt,
              title: input.title ?? `Monitor: ${firstLine}`,
              schedule: { type: "interval", everyMs: input.minutes * 60_000 },
              bindToCurrentThread: true,
            });
            const maxCycles = input.maxCycles ?? DEFAULT_MAX_CYCLES;
            const expiresAt =
              (yield* Clock.currentTimeMillis) +
              Math.round((input.expiresInHours ?? DEFAULT_EXPIRES_IN_HOURS) * HOUR_MS);
            yield* loops
              .arm({
                taskId: task.scheduledTaskId,
                threadId: thread.threadId,
                mode: input.mode,
                everyMs: input.minutes * 60_000,
                maxCycles,
                expiresAt,
                sentinel: input.stopSentinel ?? null,
              })
              .pipe(
                Effect.tapError(() =>
                  orchestrator
                    .deleteScheduledTask(scope, { scheduledTaskId: task.scheduledTaskId })
                    .pipe(Effect.ignore),
                ),
                Effect.mapError((error) => failure("orchestration_error", error.reason)),
              );
            return {
              scheduledTaskId: task.scheduledTaskId,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
              maxCycles,
              message: `Armed. It wakes this thread ${input.mode === "idle" ? `after ${input.minutes} quiet minutes` : `every ${input.minutes} minutes`}, at most ${maxCycles} times.`,
            };
          }),
        ),
      ),
      monitor_stop: McpToolAccess.actsAsCaller(({ scheduledTaskId }) =>
        withLoops((loops) =>
          Effect.gen(function* () {
            const scope = yield* McpInvocationContext.McpInvocationContext;
            const { thread } = yield* callerThread("monitor_stop");
            const orchestrator = yield* OrchestratorMcpService.OrchestratorMcpService;
            const targets =
              scheduledTaskId === undefined
                ? (yield* loops.loopsOn(thread.threadId)).map((loop) => loop.scheduledTaskId)
                : [scheduledTaskId];
            if (
              scheduledTaskId !== undefined &&
              (yield* loops.loop(scheduledTaskId)) === undefined
            ) {
              return yield* failure(
                "task_not_found",
                `${scheduledTaskId} is not a running monitor loop. Use delete_scheduled_task for other tasks.`,
              );
            }
            for (const target of targets) {
              // Another thread's loop needs the limits editing its task does.
              yield* orchestrator.authorizeScheduledTaskChange(scope, target);
              yield* loops.stop(target, "monitor_stop");
            }
            return {
              stopped: targets,
              message: targets.length === 0 ? "No loop was running here." : "Stopped.",
            };
          }),
        ),
      ),
      nothing_to_report: McpToolAccess.actsAsCaller(({ note }) =>
        withLoops((loops) =>
          Effect.gen(function* () {
            const { thread } = yield* callerThread("nothing_to_report");
            const threads = yield* ThreadManagementService.ThreadManagementService;
            const threadId = thread.threadId;
            const read = <A, E>(effect: Effect.Effect<A, E>) =>
              effect.pipe(
                Effect.mapError(() =>
                  failure("orchestration_error", `Unable to read thread ${threadId}.`),
                ),
              );
            const shell = yield* read(threads.getThreadShell(threadId));
            const runId = shell?.activeRunId ?? null;
            if (runId === null) {
              return yield* failure("run_not_found", "No turn is running in this thread.");
            }
            const { runs } = yield* read(
              threads.getThreadRecords(threadId, ["runs"], { runIds: [runId] }),
            );
            const run = runs.find((candidate) => candidate.id === runId);
            const prompt =
              run === undefined
                ? undefined
                : (yield* read(threads.getMessagesById(threadId, [run.userMessageId]))).get(
                    run.userMessageId,
                  );
            const automated =
              prompt !== undefined &&
              (prompt.scheduledTaskId !== undefined || prompt.createdBy !== "user");
            if (!automated) {
              return yield* failure(
                "invalid_request",
                "Refused: the user started this turn and is waiting on a reply. Answer them instead.",
              );
            }
            yield* loops.markQuiet({ threadId, runId, note });
            return {
              message:
                "Marked quiet: this run notifies no one. End the turn now with at most one short line.",
            };
          }),
        ),
      ),
    };
  }),
);

export const register = (registration: typeof toolkitRegistration) =>
  // The same instance upstream's orchestrator tools get: layers memoize by reference.
  registration(toolkit, layer).pipe(Layer.provide(OrchestratorMcpService.layer));
