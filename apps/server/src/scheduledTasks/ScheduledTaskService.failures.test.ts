import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { type ScheduledTask, ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const taskInput = (schedule: unknown, threadId?: string) =>
  decodeInput({
    title: "Morning review",
    prompt: "Review the open pull requests.",
    enabled: true,
    schedule,
    projectId: "project:test",
    ...(threadId === undefined ? {} : { threadId }),
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
  });

const baseDependencies = Layer.mergeAll(
  NodeCrypto.layer,
  ManagedPolicy.layerTest(),
  Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
    namedProjectsRoot: "/projects",
    isScratchProject: () => Effect.succeed(false),
  }),
  Layer.mock(SecretRequests.SecretRequests)({}),
);

// Captures the poll pass so a test drives each due run directly.
const captureSweep = (runDueWork: Ref.Ref<Effect.Effect<void>>) =>
  Layer.mock(Scheduler.Scheduler)({
    register: (name, work) =>
      name !== "scheduled-tasks"
        ? Effect.void
        : Effect.context<Effect.Services<typeof work>>().pipe(
            Effect.flatMap((context) =>
              Ref.set(runDueWork, work.pipe(Effect.provideContext(context), Effect.ignore)),
            ),
          ),
  });

it.effect("pauses a task after three failed scheduled runs in a row and says why", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-02T08:00:00.000Z"));
    const runDueWork = yield* Ref.make<Effect.Effect<void>>(Effect.void);
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          baseDependencies,
          captureSweep(runDueWork),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: () => Effect.die("The provider refused the turn."),
            isNonGitProject: () => Effect.succeed(false),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(
        yield* taskInput({ type: "cron", expression: "* * * * *", timeZone: "Europe/London" }),
      );
      const nextMinute = Effect.gen(function* () {
        yield* TestClock.adjust("1 minute");
        yield* Effect.flatten(Ref.get(runDueWork));
        return (yield* service.list()).tasks[0];
      });

      // A run started by hand is watched by someone, so it does not count.
      expect((yield* service.runNow({ id: task.id })).task.lastRunStatus).toBe("failed");
      for (const runCount of [2, 3]) {
        expect(yield* nextMinute).toMatchObject({ enabled: true, runCount });
      }
      expect(yield* nextMinute).toMatchObject({
        enabled: false,
        nextRunAt: null,
        runCount: 4,
        lastRunError:
          "Paused after 3 failed runs in a row. Last error: The provider refused the turn.",
      });
      expect((yield* nextMinute)?.runCount).toBe(4);

      // Turned back on, the task starts a new count.
      yield* service.setEnabled({ id: task.id, enabled: true });
      expect(yield* nextMinute).toMatchObject({ enabled: true, runCount: 5 });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

interface Outcome {
  readonly status: "completed" | "failed";
  readonly failure?: {
    readonly class?: string;
    readonly message: string;
    readonly resetAt?: string;
  };
}

// A task bound to one thread whose runs end as `outcome` says, once `gate` opens.
const boundThreadLayer = Effect.gen(function* () {
  const outcome = yield* Ref.make<Outcome>({ status: "completed" });
  const gate = yield* Ref.make(yield* Deferred.make<void>());
  yield* Deferred.succeed(yield* Ref.get(gate), undefined);
  const sent = yield* Ref.make<ReadonlyArray<string>>([]);
  const runDueWork = yield* Ref.make<Effect.Effect<void>>(Effect.void);
  const runOf = (messageId: string) => `run:${messageId}`;
  const threadManagement = Layer.mock(ThreadManagementService.ThreadManagementService)({
    sendToThread: (input) =>
      Ref.update(sent, (current) => [...current, input.messageId]).pipe(Effect.as({} as never)),
    getThreadShell: () =>
      Effect.succeed({ projectId: "project:test", archivedAt: null, deletedAt: null } as never),
    getThreadRecords: () => Effect.succeed({ runs: [], messages: [] } as never),
    getProjectThreadRecords: () =>
      Effect.gen(function* () {
        const messageIds = yield* Ref.get(sent);
        const { failure } = yield* Ref.get(outcome);
        return {
          runs: messageIds.map((id) => ({ id: runOf(id), status: "running", userMessageId: id })),
          messages: messageIds.map((id) => ({ id, runId: runOf(id) })),
          turnItems:
            failure === undefined
              ? []
              : messageIds.map((id) => ({
                  type: "error",
                  status: "failed",
                  runId: runOf(id),
                  nodeId: "node:root",
                  failure,
                })),
        } as never;
      }),
    waitForThread: (input) =>
      Ref.get(gate).pipe(
        Effect.flatMap(Deferred.await),
        Effect.andThen(Ref.get(outcome)),
        Effect.map(
          ({ status }) =>
            ({
              threadId: input.threadId,
              run: { id: input.runId, status, rootNodeId: "node:root", userMessageId: "" },
              timedOut: false,
            }) as never,
        ),
      ),
  });
  const layer = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        baseDependencies,
        threadManagement,
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        captureSweep(runDueWork),
      ),
    ),
  );
  return { outcome, gate, sent, runDueWork, layer };
});

const awaitTask = (
  service: ScheduledTaskService.ScheduledTaskService["Service"],
  predicate: (task: ScheduledTask) => boolean,
) =>
  service.subscribeList().pipe(
    Stream.map(({ tasks }) => tasks[0]),
    Stream.filter((task): task is ScheduledTask => task !== undefined && predicate(task)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect("counts only failed runs in a row toward the pause", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-02T08:00:00.000Z"));
    const { outcome, gate, runDueWork, layer } = yield* boundThreadLayer;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* service.upsert(
        yield* taskInput({ type: "interval", everyMs: 60_000 }, "thread:review"),
      );
      const nextMinute = Effect.andThen(
        TestClock.adjust("1 minute"),
        Effect.flatten(Ref.get(runDueWork)),
      );
      const failedRun = Effect.fnUntraced(function* (runCount: number) {
        yield* nextMinute;
        return yield* awaitTask(
          service,
          (current) => current.runCount === runCount && current.lastRunStatus === "failed",
        );
      });
      yield* Ref.set(outcome, {
        status: "failed",
        failure: { message: "The model is overloaded." },
      });
      yield* failedRun(1);
      yield* failedRun(2);

      // A run that completes clears the count. Hold its outcome until the list is watched.
      const completed = yield* Deferred.make<void>();
      yield* Ref.set(gate, completed);
      yield* Ref.update(outcome, (current) => ({ ...current, status: "completed" as const }));
      yield* nextMinute;
      const changes = yield* Queue.unbounded<unknown>();
      yield* service.subscribeList().pipe(
        Stream.runForEach((list) => Queue.offer(changes, list)),
        Effect.forkScoped,
      );
      yield* Queue.take(changes);
      yield* Deferred.succeed(completed, undefined);
      yield* Queue.take(changes);

      yield* Ref.update(outcome, (current) => ({ ...current, status: "failed" as const }));
      expect((yield* failedRun(4)).enabled).toBe(true);
      expect((yield* failedRun(5)).enabled).toBe(true);
      const paused = yield* failedRun(6);
      expect(paused).toMatchObject({
        enabled: false,
        nextRunAt: null,
        lastRunError: "Paused after 3 failed runs in a row. Last error: The model is overloaded.",
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("holds a task at its account's usage limit and runs it once after the reset", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-02T08:00:00.000Z"));
    const resetAt = "2026-11-02T10:00:00.000Z";
    const { outcome, sent, runDueWork, layer } = yield* boundThreadLayer;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert(
        yield* taskInput({ type: "interval", everyMs: 60_000 }, "thread:review"),
      );
      yield* Ref.set(outcome, {
        status: "failed",
        failure: { class: "usage_limit", message: "Weekly usage limit reached", resetAt },
      });
      yield* service.runNow({ id: task.id });
      const held = yield* awaitTask(service, (current) => current.lastRunStatus === "failed");
      expect(held).toMatchObject({
        enabled: true,
        nextRunAt: resetAt,
        lastRunError: "Weekly usage limit reached",
      });

      // Every minute until the reset passes without a run.
      const sweep = Effect.flatten(Ref.get(runDueWork));
      for (let minute = 0; minute < 119; minute++) {
        yield* TestClock.adjust("1 minute");
        yield* sweep;
      }
      expect(yield* Ref.get(sent)).toHaveLength(1);

      yield* Ref.set(outcome, { status: "completed" });
      yield* TestClock.adjust("1 minute");
      yield* sweep;
      expect(yield* Ref.get(sent)).toHaveLength(2);
      expect((yield* service.list()).tasks[0]).toMatchObject({
        enabled: true,
        lastRunStatus: "succeeded",
        nextRunAt: "2026-11-02T10:01:00.000Z",
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
