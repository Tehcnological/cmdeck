import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import WorkflowsMigration from "../../persistence/Migrations/110_Workflows.ts";
import WorkflowSkippedRunsMigration from "../../persistence/Migrations/113_WorkflowSkippedRuns.ts";
import WorkflowRunTagsMigration from "../../persistence/Migrations/115_WorkflowRunTags.ts";
import WorkflowMailSenderMigration from "../../persistence/Migrations/117_WorkflowMailSender.ts";
import WorkflowPoolsMigration from "../../persistence/Migrations/118_WorkflowPools.ts";
import WorkflowRunSubjectMigration from "../../persistence/Migrations/119_WorkflowRunSubject.ts";
import { type AgentResult, WorkflowAgents } from "../../workflows/WorkflowAgents.ts";
import * as WorkflowEngine from "../../workflows/WorkflowEngine.ts";
import { loadDefinitions } from "../../workflows/WorkflowRuntime.ts";
import * as Workflows from "../../workflows/Workflows.ts";
import type { WorkflowRun } from "../../workflows/WorkflowStore.ts";
import { PRESETS, type WorkflowPreset } from "./manifest.ts";
import { TASK_RUNNER } from "./task-runner.ts";

type Turn = Parameters<WorkflowAgents["Service"]["start"]>[0];

// Across the file: a load under an address used before would get back that module.
let loads = 0;

/**
 * A server holding one preset, played by `agent`: it answers each turn as it ends. Each `boot` is
 * one lifetime of the server on the same database, as after a restart.
 */
const presetServer = Effect.fnUntraced(function* (
  preset: WorkflowPreset,
  agent: (turn: Turn) => Effect.Effect<Partial<AgentResult>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-preset-" });
  const file = path.join(directory, preset.name);
  yield* fileSystem.writeFileString(file, preset.source);
  const database = NodeSqliteClient.layer({ filename: path.join(directory, "state.sqlite") });
  yield* Effect.provide(
    WorkflowsMigration.pipe(
      Effect.andThen(WorkflowSkippedRunsMigration),
      Effect.andThen(WorkflowRunTagsMigration),
      Effect.andThen(WorkflowMailSenderMigration),
      Effect.andThen(WorkflowPoolsMigration),
      Effect.andThen(WorkflowRunSubjectMigration),
    ),
    database,
  );
  /** Every start of a turn, a restart's included, so a turn started twice shows. */
  const turns: Array<Turn> = [];
  const agents = WorkflowAgents.of({
    start: (input) =>
      Effect.sync(() => {
        turns.push(input);
        return { threadId: input.thread ?? `thread-${input.key}`, turnId: input.key };
      }),
    result: (turn) =>
      Effect.map(agent(turns.find((started) => started.key === turn.turnId)!), (result) => ({
        ending: "completed" as const,
        detail: "",
        reply: "",
        ...result,
      })),
    interrupt: () => Effect.succeed("ended" as const),
  });
  const boot = <A, E>(use: (workflows: Workflows.Workflows["Service"]) => Effect.Effect<A, E>) =>
    loadDefinitions(file, ++loads).pipe(
      Effect.orDie,
      Effect.flatMap((definitions) =>
        Effect.raceFirst(
          Effect.scoped(
            Effect.provide(
              Effect.flatMap(Workflows.Workflows, use),
              WorkflowEngine.layer(definitions).pipe(
                Layer.provide(Layer.succeed(WorkflowAgents, agents)),
                Layer.provide(database),
                Layer.provide(NodeCrypto.layer),
              ),
            ),
          ),
          // The engine polls and backs off on the clock, so time runs while a server is up.
          Effect.forever(TestClock.adjust("1 second")),
        ),
      ),
    );
  return { directory, turns, boot };
});

/** The step a turn is for: its key is `<run>/<step>/<try>`. */
const stepOf = (turn: Turn) => turn.key.split("/")[1]!;

const askedAt = (name: string) => (run: WorkflowRun) =>
  run.status === "waiting" && run.detail === name;
const ended = (run: WorkflowRun) => ["completed", "stopped", "paused"].includes(run.status);

it.effect.each(PRESETS)(
  "the $id preset loads and defines a workflow named for its file",
  (preset) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-preset-" });
      const file = path.join(directory, preset.name);
      yield* fileSystem.writeFileString(file, preset.source);
      const definitions = yield* loadDefinitions(file, ++loads);
      assert.include(
        definitions.map((definition) => definition.name),
        preset.name.replace(/\.ts$/, ""),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

const REVIEWER = { instanceId: "codex", model: "gpt-review" };
const PLAN = {
  spec: "# Greeting\nSay hello in three files.",
  tasks: [1, 2, 3].map((n) => ({ title: `Part ${n}`, brief: `Write part ${n}.` })),
};

it.effect(
  "the task runner runs each task in its own thread, gated by the check, and asks when one stays broken",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      let fixesWork = false;
      let worktree = "";
      const broken = () => path.join(worktree, "broken");
      const { directory, turns, boot } = yield* presetServer(TASK_RUNNER, (turn) =>
        Effect.gen(function* () {
          const step = stepOf(turn);
          if (step === "plan-1") return { output: PLAN };
          if (step === "review") return { output: { approved: true, notes: "Fine." } };
          // Part 2 leaves the check failing, and only a fix after the restart mends it.
          if (step === "task-2") yield* fileSystem.writeFileString(broken(), "");
          if (step.startsWith("task-2-fix-") && fixesWork) yield* fileSystem.remove(broken());
          return { output: { summary: `did ${step}`, folder: worktree } };
        }).pipe(Effect.orDie),
      );
      worktree = directory;
      // Counts its runs in the worktree, and fails while `broken` is there.
      yield* fileSystem.writeFileString(
        path.join(directory, "check.mjs"),
        'import fs from "node:fs";\nfs.appendFileSync("checks.log", "x\\n");\nprocess.exit(fs.existsSync("broken") ? 1 : 0);\n',
      );
      const input = {
        project: "/home/user/app",
        goal: "Say hello",
        verify: "node check.mjs",
        review: REVIEWER,
        attempts: 2,
      };

      const runId = yield* boot((workflows) =>
        Effect.gen(function* () {
          const { runId } = yield* workflows.start("task-runner", input, { idempotencyKey: "a" });
          yield* workflows.waitFor(runId, askedAt("approve-1"));
          // The person sees the command that will run, and as whom, before approving.
          const [question] = (yield* workflows.questions).filter((asked) => asked.runId === runId);
          assert.include(JSON.stringify(question?.request), "node check.mjs");
          assert.include(JSON.stringify(question?.request), "server's user");
          yield* workflows.answer(runId, "approve-1", { choice: "approve" });
          yield* workflows.waitFor(runId, askedAt("task-2-stuck-1"));
          return runId;
        }),
      );

      // After a restart, a retry mends part 2; nothing that finished runs again.
      fixesWork = true;
      const done = yield* boot((workflows) =>
        Effect.gen(function* () {
          yield* workflows.answer(runId, "task-2-stuck-1", { choice: "retry" });
          return yield* workflows.waitFor(runId, ended);
        }),
      );
      assert.equal(done.status, "completed");
      const result = done.result as {
        readonly folder: string;
        readonly tasks: ReadonlyArray<{ readonly tries: number; readonly passed: boolean }>;
        readonly review: { readonly approved: boolean };
      };
      assert.equal(result.folder, worktree);
      assert.deepStrictEqual(
        result.tasks.map((task) => [task.tries, task.passed]),
        [
          [1, true],
          [3, true],
          [1, true],
        ],
      );
      assert.isTrue(result.review.approved);
      assert.deepStrictEqual(turns.map(stepOf), [
        "plan-1",
        "task-1",
        "task-2",
        "task-2-fix-1",
        "task-2-fix-2",
        "task-3",
        "review",
      ]);
      const byStep = new Map(turns.map((turn) => [stepOf(turn), turn]));
      // Each task is a new thread; a fix continues its task's thread.
      assert.deepStrictEqual(
        ["task-1", "task-2", "task-3"].map((step) => byStep.get(step)?.thread),
        [undefined, undefined, undefined],
      );
      assert.equal(byStep.get("task-2-fix-2")?.thread, "thread-" + byStep.get("task-2")?.key);
      assert.deepStrictEqual(byStep.get("task-1")?.launch?.workspace, {
        type: "worktree",
        baseRef: "HEAD",
      });
      for (const step of ["task-3", "review"]) {
        assert.deepStrictEqual(byStep.get(step)?.launch?.workspace, {
          type: "existing_worktree",
          worktreePath: worktree,
        });
      }
      assert.deepStrictEqual(byStep.get("review")?.model, REVIEWER);
      // Part 1, part 2 three times, part 3: the check ran five times, none again after the restart.
      const checks = yield* fileSystem.readFileString(path.join(worktree, "checks.log"));
      assert.equal(checks.trim().split("\n").length, 5);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("the spec builder revises the spec when asked and ends with it alone", () =>
  Effect.gen(function* () {
    const { turns, boot } = yield* presetServer(TASK_RUNNER, (turn) =>
      Effect.succeed({ output: { ...PLAN, spec: `spec from ${stepOf(turn)}` } }),
    );
    const done = yield* boot((workflows) =>
      Effect.gen(function* () {
        const { runId } = yield* workflows.start(
          "task-runner",
          { project: "/home/user/app", goal: "Say hello", stopAfterSpec: true },
          { idempotencyKey: "s" },
        );
        yield* workflows.waitFor(runId, askedAt("approve-1"));
        yield* workflows.answer(runId, "approve-1", { choice: "change", reason: "Use Swedish." });
        yield* workflows.waitFor(runId, askedAt("approve-2"));
        yield* workflows.answer(runId, "approve-2", { choice: "approve" });
        return yield* workflows.waitFor(runId, ended);
      }),
    );
    assert.equal(done.status, "completed");
    assert.deepStrictEqual(done.result, { spec: "spec from plan-2" });
    assert.deepStrictEqual(turns.map(stepOf), ["plan-1", "plan-2"]);
    assert.equal(turns[1]?.thread, `thread-${turns[0]?.key}`);
    assert.include(turns[1]?.prompt, "Use Swedish.");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("the task runner will not start work until a person picks the review model", () =>
  Effect.gen(function* () {
    const { turns, boot } = yield* presetServer(TASK_RUNNER, () => Effect.succeed({}));
    const done = yield* boot((workflows) =>
      Effect.gen(function* () {
        const { runId } = yield* workflows.start(
          "task-runner",
          { project: "/home/user/app", goal: "Say hello" },
          { idempotencyKey: "r" },
        );
        return yield* workflows.waitFor(runId, ended);
      }),
    );
    assert.equal(done.status, "stopped");
    assert.include(done.detail ?? "", "review");
    assert.equal(turns.length, 0);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
