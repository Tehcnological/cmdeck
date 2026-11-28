// Briefs ported from KiroCrew@b75544f0 src/kiro_crew/task_planner.py, task_executor.py and
// apps/builtins/spec_builder/skills/spec-workflow/SKILL.md (Apache-2.0); condensed, reworded for
// returns schemas, and run as one CMDeck workflow instead of Kiro's task executor.
import type { WorkflowPreset } from "./manifest.ts";
import { PRESET_STEPS } from "./steps.ts";

// The workflow file's text. No backticks or `${` inside: it is a template string.
const BODY = String.raw`
const { workflow, agent, title, stop } = T3;

const Model = Schema.Struct({ instanceId: Schema.String, model: Schema.String });
const Plan = Schema.Struct({
  spec: Schema.String,
  tasks: Schema.Array(Schema.Struct({ title: Schema.String, brief: Schema.String })).check(
    Schema.isMinLength(1),
  ),
});
const Done = Schema.Struct({ summary: Schema.String, folder: Schema.String });

const PLAN_BRIEF = [
  "You are planning work for other agents. Read what you need, but change no file.",
  "First read the project's own conventions (AGENTS.md, CLAUDE.md, contributing notes): they say how work here is built, tested and verified, and the plan must follow them.",
  "",
  "spec: one Markdown document: the goal; numbered requirements, each with acceptance criteria written as WHEN <event> THE SYSTEM SHALL <response>; the design and its key decisions; and what is out of scope.",
  "tasks: concrete, ordered implementation steps. Rules:",
  "- Each step is a single, actionable code change an agent can finish in one session, and is independently testable.",
  "- Include file paths when applicable.",
  "- Keep steps small and focused, ordered by dependency (implement before test): a step relies only on the steps before it.",
  "- Each step's brief stands alone: its agent sees only the spec, the list of steps and that brief.",
  "- No non-coding steps.",
].join("\n");

const taskBrief = (spec, tasks, index) =>
  [
    "You are an autonomous execution agent in a multi-task pipeline.",
    "Execute the current task precisely. Do not describe what you will do; just do it.",
    "Check what already exists before creating files: prior tasks may have created them.",
    "A separate review agent will verify your work. Do not commit or push.",
    "When done, submit summary (what you changed, briefly) and folder (the absolute path of the folder you worked in).",
    "",
    "## Full execution plan (follow strictly)",
    "Execute ONLY what the current task describes. Do not skip ahead or combine tasks.",
    ...tasks.map(
      (task, at) =>
        (at < index ? "[done] " : at === index ? "[now] " : "[todo] ") +
        (at + 1) +
        ". " +
        task.title +
        (at === index ? "  <- YOU ARE HERE" : ""),
    ),
    "",
    "## Spec",
    spec,
    "",
    "## Current task (" + (index + 1) + "/" + tasks.length + ")",
    tasks[index].title,
    "",
    tasks[index].brief,
  ].join("\n");

const fixBrief = (tries, output) =>
  [
    "The check failed. This is retry attempt " + (tries + 1) + ". Fix the error, don't start over.",
    "Then submit summary and folder again.",
    "",
    "## Check output",
    output,
  ].join("\n");

const reviewBrief = (spec, results) =>
  [
    "You are an independent review agent. You did NOT write this code.",
    "Separate execution agents made the uncommitted changes in this checkout (see git status and git diff).",
    "Your job: verify they match the spec. Flag real issues only; do not nitpick style. Change no file.",
    "Check:",
    "1. Do the changes do what the spec asks?",
    "2. Any obvious bugs, typos, or missing pieces?",
    "3. Any files that should have been changed but weren't?",
    "Submit approved (true when you found no real issue) and notes (the issues, or why it is fine).",
    "",
    "## Spec",
    spec,
    "",
    "## What each task's agent said it did",
    ...results.map(
      (task) =>
        "- " + task.title + ": " + task.summary + (task.passed ? "" : " (skipped: its check still failed)"),
    ),
  ].join("\n");

workflow(
  "task-runner",
  {
    version: 1,
    payload: Schema.Struct({
      /** The project's folder, or its id. */
      project: Schema.String,
      goal: Schema.String,
      /** Run after each task in its worktree, as the server's user; exit code 0 passes. */
      verify: Schema.optional(Schema.String),
      /** Required unless stopAfterSpec: the model that reviews the work, best another provider's. */
      review: Schema.optional(Model),
      baseRef: Schema.optional(Schema.String),
      /** Tries per task before asking a person. 3 by default. */
      attempts: Schema.optional(Schema.Number),
      /** End with the approved spec: the Spec Builder. */
      stopAfterSpec: Schema.optional(Schema.Boolean),
    }),
    asks: { approval: "Approve the plan", stuck: "A task keeps failing its check" },
  },
  Effect.fn(function* (input) {
    const specOnly = input.stopAfterSpec === true;
    if (!specOnly && input.review === undefined) {
      return yield* stop(
        "Choose the review model: set review to { instanceId, model }, ideally another provider than the one doing the work.",
      );
    }
    yield* title((specOnly ? "Spec: " : "Tasks: ") + input.goal);

    const planned = yield* presetApprovedPlan(
      (n, revision) =>
        revision === undefined
          ? agent("plan-" + n, {
              project: input.project,
              title: "Plan: " + input.goal,
              brief: PLAN_BRIEF + "\n\nGoal:\n" + input.goal,
              returns: Plan,
            })
          : agent("plan-" + n, {
              thread: revision.thread,
              brief: "Revise the spec and tasks as asked, then submit them again:\n" + revision.reason,
              returns: Plan,
            }),
      (plan) => ({
        title: specOnly
          ? "Approve the spec?"
          : "Run " +
            plan.tasks.length +
            " tasks? " +
            (input.verify === undefined
              ? "No check command is set: each task passes when its agent finishes."
              : "After each one, this command runs in the run's worktree as the server's user: " +
                input.verify),
        data: {
          // Clients render only data.body, so the plan a person approves must be in it.
          body:
            plan.spec +
            "\n\n**Tasks**\n\n" +
            plan.tasks.map((task, i) => i + 1 + ". " + task.title).join("\n") +
            (input.verify === undefined ? "" : "\n\n**Check command**\n\n~~~~\n" + input.verify + "\n~~~~"),
          spec: plan.spec,
          tasks: plan.tasks,
          verify: input.verify ?? null,
        },
      }),
    );
    const { spec, tasks } = planned.value;
    if (specOnly) return { spec };

    const attempts = Math.max(1, Math.floor(input.attempts ?? 3));
    let folder = undefined;
    const results = [];
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      const name = "task-" + (index + 1);
      const ran = yield* presetUntilChecked(name, {
        title: task.title,
        attempts,
        work: agent(name, {
          project: input.project,
          title: task.title,
          // The first task makes the run's worktree; the rest work in it, each in its own thread.
          workspace:
            folder === undefined
              ? { type: "worktree", baseRef: input.baseRef ?? "HEAD" }
              : { type: "existing_worktree", worktreePath: folder },
          brief: taskBrief(spec, tasks, index),
          returns: Done,
        }),
        check: (step, done) =>
          input.verify === undefined
            ? Effect.succeed({ passed: true, output: "" })
            : presetCheck(step, input.verify, folder ?? done.value.folder),
        fix: (step, done, output, tries) =>
          agent(step, { thread: done.thread, brief: fixBrief(tries, output), returns: Done }),
      });
      folder = folder ?? ran.done.value.folder;
      results.push({
        title: task.title,
        summary: ran.done.value.summary,
        tries: ran.tries,
        passed: ran.passed,
      });
    }

    const review = yield* presetReview("review", {
      project: input.project,
      model: input.review,
      title: "Review: " + input.goal,
      workspace: { type: "existing_worktree", worktreePath: folder },
      brief: reviewBrief(spec, results),
    });
    return { spec, folder, tasks: results, review: review.value };
  }),
);
`;

export const TASK_RUNNER: WorkflowPreset = {
  id: "task-runner",
  name: "task-runner.ts",
  title: "Task Runner",
  source: PRESET_STEPS + BODY,
};
