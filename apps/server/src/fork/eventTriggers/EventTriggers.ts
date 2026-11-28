import {
  type MilestoneEvent,
  ProjectId,
  ScheduledTaskEventSchedule,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import { CurrentEvents } from "./currentEvents.ts";
import {
  addToBatch,
  type Batch,
  COALESCE_WINDOW_MS,
  causedByEventTask,
  mergeBatches,
  triggerMatches,
} from "./matching.ts";

export interface EventTask {
  readonly id: ScheduledTaskId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
  readonly schedule: ScheduledTaskEventSchedule;
}

export class EventTriggers extends Context.Service<
  EventTriggers,
  {
    /** Queues `event` for each enabled event task it starts; returns those tasks. */
    readonly handle: (event: MilestoneEvent) => Effect.Effect<ReadonlyArray<ScheduledTaskId>>;
    /** Runs a task's queued events now, or queues them again while the task is still running. */
    readonly flush: (taskId: ScheduledTaskId) => Effect.Effect<void>;
  }
>()("t3/fork/eventTriggers/EventTriggers") {}

const decodeSchedule = Schema.decodeUnknownOption(
  Schema.fromJsonString(ScheduledTaskEventSchedule),
);

interface TaskRow {
  readonly task_id: string;
  readonly project_id: string;
  readonly thread_id: string | null;
  readonly schedule_json: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const hub = yield* MilestoneHub.MilestoneHub;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const scope = yield* Effect.scope;
  const pending = new Map<ScheduledTaskId, Batch>();

  const eventTasks = sql<TaskRow>`SELECT task_id, project_id, thread_id, schedule_json
    FROM scheduled_tasks
    WHERE enabled = 1 AND json_extract(schedule_json, '$.type') = 'event'`.pipe(
    Effect.map((rows) =>
      rows.flatMap((row): ReadonlyArray<EventTask> => {
        const schedule = decodeSchedule(row.schedule_json);
        return Option.isNone(schedule)
          ? []
          : [
              {
                id: ScheduledTaskId.make(row.task_id),
                projectId: ProjectId.make(row.project_id),
                threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
                schedule: schedule.value,
              },
            ];
      }),
    ),
  );

  /** Event tasks' bound threads, and the threads event-triggered runs went to, among `ids`. */
  const eventThreads = Effect.fn("EventTriggers.eventThreads")(function* (
    tasks: ReadonlyArray<EventTask>,
    ids: ReadonlyArray<string>,
  ) {
    const recorded =
      ids.length === 0
        ? []
        : yield* sql<{ readonly thread_id: string }>`SELECT thread_id FROM event_trigger_threads
              WHERE ${sql.in("thread_id", ids)}`;
    return new Set([
      ...recorded.map((row) => row.thread_id),
      ...tasks.flatMap((task) => (task.threadId === null ? [] : [task.threadId])),
    ]);
  });

  const queue = Effect.fn("EventTriggers.queue")(function* (taskId: ScheduledTaskId, batch: Batch) {
    const waiting = pending.get(taskId);
    pending.set(taskId, waiting === undefined ? batch : mergeBatches(waiting, batch));
    // The first event of a window starts its timer; the rest join it.
    if (waiting === undefined) {
      yield* Effect.sleep(COALESCE_WINDOW_MS).pipe(
        Effect.andThen(flush(taskId)),
        Effect.forkIn(scope),
      );
    }
  });

  const handle: EventTriggers["Service"]["handle"] = Effect.fn("EventTriggers.handle")(
    function* (event) {
      const tasks = yield* eventTasks;
      if (tasks.length === 0) return [];
      const ids = [event.threadId, event.parentThreadId].filter((id) => id !== null);
      const guarded = yield* eventThreads(tasks, ids);
      if (causedByEventTask(event, guarded)) return [];
      const started = tasks.filter((task) => triggerMatches(task.schedule, event));
      for (const task of started) yield* queue(task.id, addToBatch(undefined, event));
      return started.map((task) => task.id);
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not match an event to event tasks", { cause }).pipe(Effect.as([])),
    ),
  );

  const flush: EventTriggers["Service"]["flush"] = Effect.fn("EventTriggers.flush")(
    function* (taskId) {
      const batch = pending.get(taskId);
      if (batch === undefined) return;
      pending.delete(taskId);
      const [row] = yield* sql<{
        readonly enabled: number;
        readonly last_run_status: string;
        readonly type: string | null;
      }>`SELECT enabled, last_run_status, json_extract(schedule_json, '$.type') AS type
        FROM scheduled_tasks WHERE task_id = ${taskId}`;
      // Paused, deleted or switched to another trigger while it waited: the events lapse.
      if (row === undefined || row.enabled !== 1 || row.type !== "event") return;
      if (row.last_run_status === "running") return yield* queue(taskId, batch);
      const { threadId } = yield* scheduledTasks
        .runNow({ id: taskId })
        .pipe(Effect.provideService(CurrentEvents, batch));
      if (threadId === null) return;
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* sql`INSERT OR IGNORE INTO event_trigger_threads (thread_id, task_id, created_at)
        VALUES (${threadId}, ${taskId}, ${at})`;
    },
    (effect, taskId) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Event-triggered run failed", { taskId, cause }),
        ),
      ),
  );

  const events = yield* hub.subscribe();
  yield* events.pipe(Stream.runForEach(handle), Effect.forkIn(scope));

  return EventTriggers.of({ handle, flush });
});

export const layer = Layer.effect(EventTriggers, make);
