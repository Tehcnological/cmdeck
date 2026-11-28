import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  type MilestoneEvent,
  MilestoneId,
  ProjectId,
  RunId,
  ScheduledTaskUpsertInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as CheckScripts from "../checkScripts/CheckScripts.ts";
import { layerTest as layerChecks, makeFakeRunner } from "../checkScripts/checkScripts.testkit.ts";
import { NotificationSuppression } from "../notifications/Notifications.ts";
import * as MonitorGate from "./MonitorGate.ts";
import * as MonitorLoops from "./MonitorLoops.ts";

const PROJECT = ProjectId.make("project:test");
const OWN = ThreadId.make("thread:own");

/** What a settled run's records hold: the prompt that started it and the agent's reply. */
interface FakeRun {
  readonly prompt: { readonly scheduledTaskId?: string; readonly createdBy: "user" | "agent" };
  readonly reply: string;
}

const harness = Effect.gen(function* () {
  const fake = yield* makeFakeRunner;
  const runs = yield* Ref.make<ReadonlyMap<string, FakeRun>>(new Map());
  const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
    sendToThread: () => Effect.succeed({} as never),
    getThreadShell: (threadId) =>
      Effect.succeed({
        id: threadId,
        projectId: PROJECT,
        deletedAt: null,
        archivedAt: null,
      } as never),
    getThreadRecords: (threadId, _fields, filter) =>
      Ref.get(runs).pipe(
        Effect.map((all) => {
          const runId = filter?.runIds?.[0];
          const run = runId === undefined ? undefined : all.get(runId);
          return {
            runs: run === undefined ? [] : [{ id: runId, userMessageId: `prompt:${runId}` }],
            messages: run === undefined ? [] : [{ threadId, role: "assistant", text: run.reply }],
          } as never;
        }),
      ),
    getMessagesById: (_threadId, ids) =>
      Ref.get(runs).pipe(
        Effect.map(
          (all) =>
            new Map(
              ids.flatMap((id) => {
                const run = all.get(id.replace("prompt:", ""));
                return run === undefined ? [] : [[id, run.prompt as never]];
              }),
            ),
        ),
      ),
  });
  const checks = MonitorGate.checkScriptsLayer.pipe(
    Layer.provide(layerChecks(fake.runner)),
    Layer.provideMerge(MonitorGate.layer),
  );
  const scheduler = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ManagedPolicy.layerTest(),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          isNonGitProject: () => Effect.succeed(false),
        }),
        threads,
      ),
    ),
  );
  const layer = MonitorLoops.layer.pipe(
    Layer.provideMerge(scheduler),
    Layer.provideMerge(checks),
    Layer.provideMerge(threads),
    Layer.provideMerge(MonitorLoops.suppressionLayer),
    Layer.provideMerge(MilestoneHub.layer),
    Layer.provideMerge(NodeCrypto.layer),
  );
  return { runs, layer };
});

const run = <A, E>(
  body: (
    runs: Ref.Ref<ReadonlyMap<string, FakeRun>>,
  ) => Effect.Effect<
    A,
    E,
    | MonitorLoops.MonitorLoops
    | MonitorGate.MonitorGate
    | ScheduledTaskService.ScheduledTaskService
    | SqlClient.SqlClient
  >,
) =>
  Effect.gen(function* () {
    const { runs, layer } = yield* harness;
    return yield* body(runs).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory));

const decodeInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

/** A loop task on OWN, armed as monitor_start arms it. */
const armLoop = (options: Partial<MonitorLoops.ArmInput> = {}) =>
  Effect.gen(function* () {
    const service = yield* ScheduledTaskService.ScheduledTaskService;
    const { task } = yield* service.upsert(
      yield* decodeInput({
        title: "Monitor: CI",
        prompt: "Check CI on acme/app.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: PROJECT,
        threadId: OWN,
        threadMode: "continue",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "approval-required",
        interactionMode: "default",
      }),
    );
    yield* (yield* MonitorLoops.MonitorLoops).arm({
      taskId: task.id,
      threadId: OWN,
      mode: "interval",
      everyMs: 60_000,
      maxCycles: 2,
      expiresAt: 3_600_000,
      sentinel: "MONITOR_DONE",
      ...options,
    });
    return task;
  });

const seedThread = Effect.fn(function* (threadId: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_threads
    (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at,
      updated_at, payload_json)
    VALUES (${threadId}, ${PROJECT}, 'Own', 'codex', 'approval-required', 'default',
      '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z', '{}')`;
});

const seedRun = Effect.fn(function* (status: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_runs
    (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
    VALUES ('run:busy', ${OWN}, 1, 'codex', ${status}, '2026-11-28T00:00:00.000Z', '{}')`;
});

const tick = (task: { readonly id: string; readonly createdAt: string }) =>
  CheckScripts.CheckScripts.pipe(
    Effect.flatMap((checks) =>
      checks.gate({
        task: {
          ...(task as never as CheckScripts.CheckedTask),
          id: task.id as never,
          createdAt: task.createdAt,
        },
        prompt: "Check CI on acme/app.",
        trigger: "scheduled",
      }),
    ),
  );

const loopRow = (taskId: string) =>
  SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) =>
        sql<{
          readonly cycles: number;
          readonly stopped_reason: string | null;
          readonly expires_at: number;
        }>`SELECT cycles, stopped_reason, expires_at FROM monitor_loops WHERE task_id = ${taskId}`,
    ),
    Effect.map((rows) => rows[0]),
  );

const settledEvent = (runId: string, occurredAt: string): MilestoneEvent => ({
  id: MilestoneId.make(`settled:${runId}`),
  occurredAt,
  projectId: PROJECT,
  threadId: OWN,
  parentThreadId: null,
  actor: { type: "agent" },
  isSubagentChild: false,
  type: "thread.run_settled",
  runId: RunId.make(runId),
  outcome: "completed",
});

describe("monitor loops", () => {
  it.effect("each wake carries the loop note; the budget ends the loop and removes its task", () =>
    run(() =>
      Effect.gen(function* () {
        yield* seedThread(OWN);
        const task = yield* armLoop();
        const first = yield* tick(task);
        const second = yield* tick(task);
        expect(first).toMatchObject({ _tag: "Wake" });
        expect(first?._tag === "Wake" && first.prompt).toContain("Check CI on acme/app.\n\n");
        expect(first?._tag === "Wake" && first.prompt).toContain("wake 1 of 2");
        expect(second?._tag === "Wake" && second.prompt).toContain("This is the last wake.");

        expect(yield* tick(task)).toEqual({ _tag: "Done" });
        expect(yield* loopRow(task.id)).toMatchObject({ cycles: 2, stopped_reason: "budget" });
        const scheduled = yield* ScheduledTaskService.ScheduledTaskService;
        // The stop pauses the task at once; the loop service then removes it.
        for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow;
        expect((yield* scheduled.list()).tasks.map((each) => each.id)).not.toContain(task.id);
      }),
    ),
  );

  it.effect("a busy thread skips the wake without spending it; archiving the thread ends it", () =>
    run(() =>
      Effect.gen(function* () {
        yield* seedThread(OWN);
        const task = yield* armLoop();
        yield* seedRun("running");
        expect(yield* tick(task)).toEqual({ _tag: "Done" });
        expect(yield* loopRow(task.id)).toMatchObject({ cycles: 0, stopped_reason: null });

        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_v2_projection_threads
          SET archived_at = '2026-11-28T01:00:00.000Z' WHERE thread_id = ${OWN}`;
        expect(yield* tick(task)).toEqual({ _tag: "Done" });
        expect((yield* loopRow(task.id))?.stopped_reason).toBe("thread_archived");
      }),
    ),
  );

  it.effect("the loop ends at its expiry", () =>
    run(() =>
      Effect.gen(function* () {
        yield* seedThread(OWN);
        const task = yield* armLoop({ expiresAt: 120_000 });
        expect(yield* tick(task)).toMatchObject({ _tag: "Wake" });
        yield* TestClock.adjust("3 minutes");
        expect(yield* tick(task)).toEqual({ _tag: "Done" });
        expect((yield* loopRow(task.id))?.stopped_reason).toBe("expired");
      }),
    ),
  );

  it.effect("an unchanged check output skips; a changed one wakes", () =>
    run(() =>
      Effect.gen(function* () {
        yield* seedThread(OWN);
        const task = yield* armLoop({ maxCycles: 5 });
        const gate = yield* MonitorGate.MonitorGate;
        const input = {
          task: { ...(task as never as CheckScripts.CheckedTask), id: task.id as never },
          prompt: "Check CI on acme/app.",
          trigger: "scheduled" as const,
        };
        const wake = (output: string) => ({ _tag: "Wake" as const, prompt: `Check CI\n${output}` });
        expect(yield* gate.gate(input, wake("red"))).toMatchObject({ _tag: "Wake" });
        expect(yield* gate.gate(input, wake("red"))).toEqual({ _tag: "Done" });
        expect(yield* gate.gate(input, wake("green"))).toMatchObject({ _tag: "Wake" });
        expect((yield* loopRow(task.id))?.cycles).toBe(2);
      }),
    ),
  );

  it.effect(
    "the sentinel in a reply to the loop's wake ends it; in a user's turn it does not",
    () =>
      run((runs) =>
        Effect.gen(function* () {
          yield* seedThread(OWN);
          const task = yield* armLoop();
          const loops = yield* MonitorLoops.MonitorLoops;
          yield* Ref.set(
            runs,
            new Map([
              ["run:user", { prompt: { createdBy: "user" }, reply: "I'll say\nMONITOR_DONE" }],
              [
                "run:wake",
                {
                  prompt: { scheduledTaskId: task.id, createdBy: "agent" },
                  reply: "Green.\nMONITOR_DONE",
                },
              ],
            ]),
          );
          yield* loops.settled(settledEvent("run:user", "2026-11-28T01:00:00.000Z"));
          expect((yield* loopRow(task.id))?.stopped_reason).toBeNull();

          yield* loops.settled(settledEvent("run:wake", "2026-11-28T01:05:00.000Z"));
          expect((yield* loopRow(task.id))?.stopped_reason).toBe("sentinel");
          const scheduled = yield* ScheduledTaskService.ScheduledTaskService;
          expect((yield* scheduled.list()).tasks).toEqual([]);
        }),
      ),
  );

  it.effect(
    "any settled turn, a user's included, restarts the idle wait but not the deadline",
    () =>
      run(() =>
        Effect.gen(function* () {
          yield* seedThread(OWN);
          const task = yield* armLoop({ mode: "idle", everyMs: 300_000, sentinel: null });
          const loops = yield* MonitorLoops.MonitorLoops;
          const sql = yield* SqlClient.SqlClient;
          const nextRun = sql<{ readonly next_run_at: string }>`SELECT next_run_at
          FROM scheduled_tasks WHERE task_id = ${task.id}`.pipe(
            Effect.map((rows) => rows[0]?.next_run_at),
          );

          yield* loops.settled(settledEvent("run:user", "2026-11-28T02:00:00.000Z"));
          expect(yield* nextRun).toBe("2026-11-28T02:05:00.000Z");
          // An older settle never pulls the wake earlier.
          yield* loops.settled(settledEvent("run:old", "2026-11-28T01:00:00.000Z"));
          expect(yield* nextRun).toBe("2026-11-28T02:05:00.000Z");
          expect((yield* loopRow(task.id))?.expires_at).toBe(3_600_000);
        }),
      ),
  );

  it.effect("a quiet run's settle is suppressed; other runs still notify", () =>
    run(() =>
      Effect.gen(function* () {
        const loops = yield* MonitorLoops.MonitorLoops;
        yield* loops.markQuiet({
          threadId: OWN,
          runId: RunId.make("run:quiet"),
          note: "No change.",
        });
        const suppression = yield* NotificationSuppression;
        expect(
          yield* suppression.suppress(settledEvent("run:quiet", "2026-11-28T03:00:00.000Z")),
        ).toBe(true);
        expect(
          yield* suppression.suppress(settledEvent("run:other", "2026-11-28T03:00:00.000Z")),
        ).toBe(false);
      }),
    ),
  );
});
