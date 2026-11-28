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
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
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
import * as EventTriggers from "./EventTriggers.ts";
import { COALESCE_WINDOW_MS } from "./matching.ts";

const PROJECT = ProjectId.make("project:test");

interface Sent {
  readonly threadId: ThreadId;
  readonly text: string;
  readonly runtimeMode?: string;
  readonly interactionMode?: string;
}

/** The real scheduler and trigger service; every launch gets a new thread and is recorded. */
const harness = Effect.gen(function* () {
  const fake = yield* makeFakeRunner;
  const sent = yield* Ref.make<ReadonlyArray<Sent>>([]);
  const launches = yield* Ref.make(0);
  const scheduler = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        ManagedPolicy.layerTest(),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Ref.updateAndGet(launches, (count) => count + 1).pipe(
              Effect.map((count) => ThreadId.make(`thread:launched-${count}`)),
              Effect.tap((threadId) =>
                Ref.update(sent, (current) => [
                  ...current,
                  {
                    threadId,
                    text: input.initialMessage?.text ?? "",
                    runtimeMode: input.runtimeMode,
                    interactionMode: input.interactionMode,
                  },
                ]),
              ),
              Effect.map((threadId) => ({ threadId }) as never),
            ),
          isNonGitProject: () => Effect.succeed(false),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          sendToThread: (input) =>
            Ref.update(sent, (current) => [
              ...current,
              { threadId: input.threadId, text: input.text },
            ]).pipe(Effect.as({} as never)),
          getThreadShell: (threadId) =>
            Effect.succeed({
              id: threadId,
              projectId: PROJECT,
              deletedAt: null,
              archivedAt: null,
            } as never),
        }),
      ),
    ),
  );
  const layer = EventTriggers.layer.pipe(
    Layer.provideMerge(scheduler.pipe(Layer.provideMerge(layerChecks(fake.runner)))),
    Layer.provideMerge(MilestoneHub.layer),
  );
  return { fake, sent, layer };
});

const decodeInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const eventTask = (title: string, fields: Record<string, unknown> = {}) =>
  Effect.gen(function* () {
    const service = yield* ScheduledTaskService.ScheduledTaskService;
    const { task } = yield* service.upsert(
      yield* decodeInput({
        title,
        prompt: `${title}: triage the failed turn.`,
        enabled: true,
        schedule: { type: "event", events: ["thread.run_settled"], outcomes: ["failed"] },
        projectId: PROJECT,
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
        ...fields,
      }),
    );
    return task;
  });

const failedIn = (
  threadId: string,
  id = `settled:${threadId}`,
  outcome: "completed" | "failed" = "failed",
): MilestoneEvent => ({
  id: MilestoneId.make(id),
  occurredAt: "2026-11-28T10:00:00.000Z",
  projectId: PROJECT,
  threadId: ThreadId.make(threadId),
  parentThreadId: null,
  actor: { type: "agent" },
  isSubagentChild: false,
  type: "thread.run_settled",
  runId: RunId.make(`run:${id}`),
  outcome,
});

const run = <A, E>(
  body: (
    sent: Ref.Ref<ReadonlyArray<Sent>>,
    fake: Effect.Success<typeof makeFakeRunner>,
  ) => Effect.Effect<
    A,
    E,
    | EventTriggers.EventTriggers
    | ScheduledTaskService.ScheduledTaskService
    | MilestoneHub.MilestoneHub
  >,
) =>
  Effect.gen(function* () {
    const { fake, sent, layer } = yield* harness;
    return yield* body(sent, fake).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory));

describe("event triggers", () => {
  it.effect("an event runs the task once, with the event after its prompt, in its own modes", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const task = yield* eventTask("Triage");

        expect(yield* triggers.handle(failedIn("thread:user"))).toEqual([task.id]);
        yield* triggers.flush(task.id);
        yield* triggers.flush(task.id);

        const [only, ...rest] = yield* Ref.get(sent);
        expect(rest).toEqual([]);
        expect(only?.text.startsWith("Triage: triage the failed turn.\n\nThis event started")).toBe(
          true,
        );
        expect(only?.text).toContain('"id":"settled:thread:user"');
        expect(only).toMatchObject({ runtimeMode: "approval-required", interactionMode: "plan" });
      }),
    ),
  );

  it.effect("a burst of events becomes one run that lists them all", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const task = yield* eventTask("Triage");
        yield* triggers.handle(failedIn("thread:a"));
        yield* triggers.handle(failedIn("thread:b"));
        yield* triggers.flush(task.id);

        const runs = yield* Ref.get(sent);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.text).toContain("These 2 events started this run");
      }),
    ),
  );

  it.effect("an event that does not match, or a paused task, starts nothing", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        const task = yield* eventTask("Triage");
        expect(yield* triggers.handle(failedIn("thread:user", "settled:ok", "completed"))).toEqual(
          [],
        );

        yield* triggers.handle(failedIn("thread:user"));
        yield* service.setEnabled({ id: task.id, enabled: false });
        yield* triggers.flush(task.id);
        expect(yield* triggers.handle(failedIn("thread:other"))).toEqual([]);
        expect(yield* Ref.get(sent)).toEqual([]);
      }),
    ),
  );

  it.effect("a task's own run never triggers it again", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const task = yield* eventTask("Triage");
        yield* triggers.handle(failedIn("thread:user"));
        yield* triggers.flush(task.id);
        const [first] = yield* Ref.get(sent);

        // Its run failed too, and a subagent it started failed as well.
        expect(yield* triggers.handle(failedIn(first!.threadId))).toEqual([]);
        expect(
          yield* triggers.handle({
            ...failedIn("thread:child"),
            parentThreadId: first!.threadId,
          }),
        ).toEqual([]);
      }),
    ),
  );

  it.effect("two event tasks cannot trigger each other in a chain", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const first = yield* eventTask("First");
        const second = yield* eventTask("Second");
        expect(yield* triggers.handle(failedIn("thread:user"))).toEqual([first.id, second.id]);
        yield* triggers.flush(first.id);
        yield* triggers.flush(second.id);
        const launched = (yield* Ref.get(sent)).map((entry) => entry.threadId);
        expect(launched).toHaveLength(2);

        for (const threadId of launched)
          expect(yield* triggers.handle(failedIn(threadId))).toEqual([]);
      }),
    ),
  );

  it.effect("a task bound to a thread ignores what happens in that thread", () =>
    run((sent) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const bound = yield* eventTask("Bound", {
          threadId: "thread:own",
          threadMode: "continue",
        });
        expect(yield* triggers.handle(failedIn("thread:own"))).toEqual([]);
        expect(yield* triggers.handle(failedIn("thread:elsewhere"))).toEqual([bound.id]);
        yield* triggers.flush(bound.id);
        expect((yield* Ref.get(sent)).map((entry) => entry.threadId)).toEqual(["thread:own"]);
      }),
    ),
  );

  it.effect("a task's check script sees the events and can skip the run", () =>
    run((sent, fake) =>
      Effect.gen(function* () {
        const triggers = yield* EventTriggers.EventTriggers;
        const checks = yield* CheckScripts.CheckScripts;
        const task = yield* eventTask("Triage");
        yield* checks.set({
          taskId: task.id,
          check: { interpreter: "node", script: "process.exit(10)" },
          by: "user",
        });
        yield* Ref.set(fake.next, { code: 10 });
        yield* triggers.handle(failedIn("thread:user"));
        yield* triggers.flush(task.id);

        const [call] = yield* Ref.get(fake.calls);
        expect(call?.env).toMatchObject({ CMDECK_TRIGGER: "event" });
        expect(JSON.parse(call?.env?.CMDECK_EVENTS ?? "[]")).toMatchObject([
          { id: "settled:thread:user", outcome: "failed" },
        ]);
        expect(yield* Ref.get(sent)).toEqual([]);
      }),
    ),
  );

  it.effect("a published milestone runs the task after the coalescing window", () =>
    run(() =>
      Effect.gen(function* () {
        const hub = yield* MilestoneHub.MilestoneHub;
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        yield* EventTriggers.EventTriggers;
        const task = yield* eventTask("Triage");
        const ran = yield* service.subscribeList().pipe(
          Stream.map((result) => result.tasks.find((current) => current.id === task.id)),
          Stream.filter(
            (current) => current?.runCount === 1 && current.lastRunStatus !== "running",
          ),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* hub.publish(failedIn("thread:user"));
        yield* hub.publish(failedIn("thread:user", "settled:again"));
        yield* TestClock.adjust(COALESCE_WINDOW_MS);
        const recorded = Option.getOrThrow(yield* Fiber.join(ran));
        expect(recorded?.runCount).toBe(1);
      }),
    ),
  );
});
