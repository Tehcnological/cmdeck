/**
 * Building blocks shared by preset workflow files, as source text: a workflow file imports nothing
 * from the server, so each preset carries its own copy at the top of its file. They use `T3.*` in
 * full so a preset's own `const { … } = T3;` line never clashes with them.
 *
 * Written without backticks or `${`, since they live inside a template string.
 */
export const PRESET_STEPS = String.raw`import { exec } from "node:child_process";

// --- CMDeck preset steps: shared by CMDeck's presets. ---

const PresetCheck = Schema.Struct({ passed: Schema.Boolean, output: Schema.String });

/** Runs a shell command in a folder as the server's user. Never fails: says whether it passed, with the end of its output. */
const presetCheck = (name, command, cwd) =>
  T3.step(
    name,
    { returns: PresetCheck },
    Effect.promise(
      () =>
        new Promise((resolve) => {
          exec(
            command,
            { cwd, timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
              const output = (String(stdout) + String(stderr)).trim();
              resolve({
                passed: error === null,
                output: (output || (error === null ? "" : error.message)).slice(-4000),
              });
            },
          );
        }),
    ),
  );

/**
 * Plans until a person approves. plan(n, revision) makes plan n, where revision is
 * { thread, reason } after a person asked for changes. ask(plan) gives the question's title and
 * data. Returns the approved plan's agent result, or stops the run.
 */
const presetApprovedPlan = (plan, ask) =>
  Effect.gen(function* () {
    let revision = undefined;
    for (let n = 1; ; n++) {
      const made = yield* plan(n, revision);
      const answer = yield* T3.ask("approve-" + n, {
        kind: "approval",
        ...ask(made.value),
        choices: [
          "approve",
          { value: "change", description: "Say what to change.", requireReason: true },
          "stop",
        ],
      });
      if (Option.isNone(answer) || answer.value.choice === "stop") {
        return yield* T3.stop("The plan was not approved.");
      }
      if (answer.value.choice === "approve") return made;
      revision = { thread: made.thread, reason: answer.value.reason };
    }
  });

/**
 * Runs work, then check(stepName, done), and while the check fails runs
 * fix(stepName, done, output, tries) and checks again. After every attempts tries it asks a person to
 * retry, skip or stop. Returns { done, tries, passed }, with done the last work or fix result.
 */
const presetUntilChecked = (name, options) =>
  Effect.gen(function* () {
    let done = yield* options.work;
    for (let tries = 1; ; tries++) {
      const checked = yield* options.check(name + "-check-" + tries, done);
      if (checked.passed) return { done, tries, passed: true };
      if (tries % options.attempts === 0) {
        const answer = yield* T3.ask(name + "-stuck-" + tries / options.attempts, {
          kind: "stuck",
          title: options.title + " still fails its check after " + tries + " tries.",
          choices: ["retry", "skip", "stop"],
          data: { body: "~~~~\n" + checked.output + "\n~~~~", output: checked.output },
        });
        if (Option.isNone(answer) || answer.value.choice === "stop") {
          return yield* T3.stop(options.title + " kept failing its check.");
        }
        if (answer.value.choice === "skip") return { done, tries, passed: false };
      }
      done = yield* options.fix(name + "-fix-" + tries, done, checked.output, tries);
    }
  });

const PresetReview = Schema.Struct({ approved: Schema.Boolean, notes: Schema.String });

/** A review by an agent on the model a person picked, usually another provider's. */
const presetReview = (name, options) => T3.agent(name, { ...options, returns: PresetReview });

// --- End of CMDeck preset steps. ---
`;
