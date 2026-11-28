// Fork-only. Monitor loops (WI-2.12): a scheduled task bound to the agent's own thread in
// `continue` mode, with a budget, an expiry and an optional stop sentinel. The scheduler fires it;
// MonitorGate decides each run; this service arms loops, ends them, and follows the thread's turns.
import {
  type MilestoneEvent,
  type RunId,
  type ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import { NotificationSuppression } from "../notifications/Notifications.ts";
import { type LoopMode, replyHasSentinel } from "./decide.ts";
import { type LoopRow, MonitorGate } from "./MonitorGate.ts";

export class MonitorLoopError extends Schema.TaggedError<MonitorLoopError>()("MonitorLoopError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export interface ArmInput {
  readonly taskId: ScheduledTaskId;
  readonly threadId: ThreadId;
  readonly mode: LoopMode;
  readonly everyMs: number;
  readonly maxCycles: number;
  readonly expiresAt: number;
  readonly sentinel: string | null;
}

export interface LoopSummary {
  readonly scheduledTaskId: ScheduledTaskId;
  readonly threadId: ThreadId;
  readonly mode: LoopMode;
  readonly cycles: number;
  readonly maxCycles: number;
  readonly expiresAt: number;
}

/** Stopped loops and quiet turns are kept this long, for a later look at why a loop ended. */
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NOTE_CHARS = 500;

export class MonitorLoops extends Context.Service<
  MonitorLoops,
  {
    /** Records the loop for a task just created on its thread. */
    readonly arm: (input: ArmInput) => Effect.Effect<LoopSummary, MonitorLoopError>;
    /** Running loops on a thread. */
    readonly loopsOn: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<LoopSummary>>;
    /** The loop a task is, if it is a running one. */
    readonly loop: (taskId: ScheduledTaskId) => Effect.Effect<LoopSummary | undefined>;
    /** Marks the loop ended and removes its task. */
    readonly stop: (taskId: ScheduledTaskId, reason: string) => Effect.Effect<void>;
    /** Marks a run quiet: no one is notified when it settles. */
    readonly markQuiet: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly note: string | undefined;
    }) => Effect.Effect<void>;
    /** Follows one settled run: a loop's sentinel ends it, and idle loops count from it. */
    readonly settled: (event: MilestoneEvent) => Effect.Effect<void>;
  }
>()("t3/fork/monitoring/MonitorLoops") {}

const summaryOf = (row: LoopRow): LoopSummary => ({
  scheduledTaskId: row.task_id as ScheduledTaskId,
  threadId: ThreadId.make(row.thread_id),
  mode: row.mode,
  cycles: row.cycles,
  maxCycles: row.max_cycles,
  expiresAt: row.expires_at,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const hub = yield* MilestoneHub.MilestoneHub;
  const gate = yield* MonitorGate;

  const running = (by: { readonly threadId: string } | { readonly taskId: string }) =>
    sql<LoopRow>`SELECT l.* FROM monitor_loops l
      JOIN scheduled_tasks t ON t.task_id = l.task_id AND t.created_at = l.task_created_at
      WHERE l.stopped_reason IS NULL AND ${
        "threadId" in by ? sql`l.thread_id = ${by.threadId}` : sql`l.task_id = ${by.taskId}`
      }`;

  const arm: MonitorLoops["Service"]["arm"] = Effect.fn("MonitorLoops.arm")(
    function* (input) {
      const [task] = yield* sql<{ readonly created_at: string }>`SELECT created_at
        FROM scheduled_tasks WHERE task_id = ${input.taskId}`;
      if (task === undefined) {
        return yield* new MonitorLoopError({ reason: "The loop's scheduled task is gone." });
      }
      const now = yield* Clock.currentTimeMillis;
      yield* sql`INSERT INTO monitor_loops ${sql.insert({
        task_id: input.taskId,
        task_created_at: task.created_at,
        thread_id: input.threadId,
        mode: input.mode,
        every_ms: input.everyMs,
        max_cycles: input.maxCycles,
        cycles: 0,
        expires_at: input.expiresAt,
        stop_sentinel: input.sentinel,
        last_output_hash: null,
        stopped_reason: null,
        stopped_at: null,
        created_at: now,
      })} ON CONFLICT (task_id) DO UPDATE SET task_created_at = excluded.task_created_at,
        thread_id = excluded.thread_id, mode = excluded.mode, every_ms = excluded.every_ms,
        max_cycles = excluded.max_cycles, cycles = 0, expires_at = excluded.expires_at,
        stop_sentinel = excluded.stop_sentinel, last_output_hash = NULL, stopped_reason = NULL,
        stopped_at = NULL, created_at = excluded.created_at`;
      yield* sql`DELETE FROM monitor_loops WHERE stopped_at < ${now - KEPT_MS}`;
      yield* sql`DELETE FROM quiet_turns WHERE created_at < ${now - KEPT_MS}`;
      return {
        scheduledTaskId: input.taskId,
        threadId: input.threadId,
        mode: input.mode,
        cycles: 0,
        maxCycles: input.maxCycles,
        expiresAt: input.expiresAt,
      };
    },
    Effect.catchTags({
      SqlError: (cause) =>
        Effect.fail(new MonitorLoopError({ reason: `Could not arm the loop: ${cause.message}` })),
    }),
  );

  const loopsOn: MonitorLoops["Service"]["loopsOn"] = (threadId) =>
    running({ threadId }).pipe(
      Effect.map((rows) => rows.map(summaryOf)),
      Effect.orElseSucceed(() => []),
    );

  const loop: MonitorLoops["Service"]["loop"] = (taskId) =>
    running({ taskId }).pipe(
      Effect.map((rows) => (rows[0] === undefined ? undefined : summaryOf(rows[0]))),
      Effect.orElseSucceed(() => undefined),
    );

  const stop: MonitorLoops["Service"]["stop"] = Effect.fn("MonitorLoops.stop")(
    function* (taskId, reason) {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`UPDATE monitor_loops SET stopped_reason = COALESCE(stopped_reason, ${reason}),
        stopped_at = COALESCE(stopped_at, ${now}) WHERE task_id = ${taskId}`;
      yield* scheduledTasks.delete({ id: taskId });
    },
    (effect, taskId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not end a monitor loop", { taskId, cause }),
        ),
      ),
  );

  const markQuiet: MonitorLoops["Service"]["markQuiet"] = Effect.fn("MonitorLoops.markQuiet")(
    function* ({ threadId, runId, note }) {
      const now = yield* Clock.currentTimeMillis;
      const kept = note?.trim().slice(0, MAX_NOTE_CHARS) || null;
      yield* sql`INSERT INTO quiet_turns (thread_id, run_id, note, created_at)
        VALUES (${threadId}, ${runId}, ${kept}, ${now})
        ON CONFLICT (thread_id, run_id) DO UPDATE SET note = excluded.note`;
    },
    Effect.orDie,
  );

  /** Whether `runId` answered one of the loop's wakes and its reply holds the sentinel. */
  const sentinelSeen = Effect.fn("MonitorLoops.sentinelSeen")(function* (
    row: LoopRow,
    runId: RunId,
  ) {
    if (row.stop_sentinel === null) return false;
    const threadId = ThreadId.make(row.thread_id);
    const { runs, messages } = yield* threads.getThreadRecords(threadId, ["runs", "messages"], {
      runIds: [runId],
      messageRunIds: [runId],
      messageRoles: ["assistant"],
    });
    const run = runs.find((candidate) => candidate.id === runId);
    if (run === undefined) return false;
    const prompt = (yield* threads.getMessagesById(threadId, [run.userMessageId])).get(
      run.userMessageId,
    );
    if (prompt?.scheduledTaskId !== row.task_id) return false;
    const sentinel = row.stop_sentinel;
    return messages.some((message) => replyHasSentinel(message.text, sentinel));
  });

  const settled: MonitorLoops["Service"]["settled"] = Effect.fn("MonitorLoops.settled")(
    function* (event) {
      if (event.type !== "thread.run_settled" || event.threadId === null) return;
      const rows = yield* running({ threadId: event.threadId });
      for (const row of rows) {
        if (yield* sentinelSeen(row, event.runId)) {
          yield* stop(row.task_id as ScheduledTaskId, "sentinel");
          continue;
        }
        if (row.mode !== "idle") continue;
        // Any turn, the user's included, restarts the quiet wait; the expiry stays.
        const next = DateTime.formatIso(
          DateTime.makeUnsafe(Date.parse(event.occurredAt) + row.every_ms),
        );
        yield* sql`UPDATE scheduled_tasks SET next_run_at = ${next}
          WHERE task_id = ${row.task_id} AND created_at = ${row.task_created_at} AND enabled = 1
            AND (next_run_at IS NULL OR next_run_at < ${next})`;
      }
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not follow a settled run for monitor loops", { cause }),
    ),
  );

  const milestones = yield* hub.subscribe({ types: ["thread.run_settled"] });
  yield* milestones.pipe(Stream.runForEach(settled), Effect.forkScoped);
  const stopped = yield* gate.subscribeStopped;
  yield* stopped.pipe(
    Stream.runForEach((loop) => scheduledTasks.delete({ id: loop.taskId }).pipe(Effect.ignore)),
    Effect.forkScoped,
  );

  return MonitorLoops.of({ arm, loopsOn, loop, stop, markQuiet, settled });
});

export const layer = Layer.effect(MonitorLoops, make);

/** A quiet run's settle notifies no channel. Read beside Notifications, which consults it. */
export const suppressionLayer = Layer.effect(
  NotificationSuppression,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      suppress: Effect.fn("NotificationSuppression.suppress")(
        function* (event: MilestoneEvent) {
          if (event.type !== "thread.run_settled" || event.threadId === null) return false;
          const rows = yield* sql`SELECT 1 FROM quiet_turns
            WHERE thread_id = ${event.threadId} AND run_id = ${event.runId}`;
          return rows.length > 0;
        },
        Effect.orElseSucceed(() => false),
      ),
    };
  }),
);
