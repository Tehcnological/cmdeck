// Fork-only. A scheduled task's check script decides whether its run wakes the agent (WI-2.11),
// in the shape of Sillage's check gate (MarlBurroW/sillage, MIT): exit 0 wakes with the output,
// exit 10 skips with no turn, anything else fails. Scripts run with the server's rights, so a
// script runs only once a person approved its exact bytes; approvals share `workflow_trust`.
import {
  CHECK_NEEDS_APPROVAL,
  type CheckInterpreter,
  CheckScriptError,
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  type ProjectId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ScheduledTaskCheck,
  type ScheduledTaskCheckState,
  type ScheduledTaskId,
  type ScheduledTaskRunStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import {
  clip,
  failureMessage,
  promptWithCheckOutput,
  runCheckScript,
  verdictOf,
} from "./runner.ts";

/** What a scheduled run does after its check. `null` from `gate`: the task has no check. */
export type GateResult =
  | { readonly _tag: "Wake"; readonly prompt: string }
  | { readonly _tag: "Done" }
  | { readonly _tag: "Failed"; readonly error: string; readonly counts: boolean };

/**
 * The scheduler's dispatch, unless the check ended the run: done starts no turn and succeeds, and
 * failed records `error` without dispatching.
 */
export const exitAfter =
  (result: GateResult | null) =>
  <A, E>(dispatch: Effect.Effect<A, E>): Effect.Effect<Exit.Exit<A | null, E | CheckScriptError>> =>
    result === null || result._tag === "Wake"
      ? Effect.exit(dispatch)
      : Effect.succeed(
          result._tag === "Done"
            ? Exit.succeed(null)
            : Exit.fail(new CheckScriptError({ reason: result.error })),
        );

export interface CheckedTask {
  readonly id: ScheduledTaskId;
  readonly createdAt: string;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly lastRunAt: string | null;
  readonly lastRunStatus: ScheduledTaskRunStatus;
}

/** A check result a person should hear about, sent on as a fork alert. */
export interface CheckReport {
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  readonly projectId: string;
}

export type CheckAuthor = "user" | "agent";

export interface CheckScriptsShape {
  /** Runs the task's check, if it has one, and says whether the run goes on. Never fails. */
  readonly gate: (input: {
    readonly task: CheckedTask;
    readonly prompt: string;
    readonly trigger: "scheduled" | "manual" | "webhook";
  }) => Effect.Effect<GateResult | null>;
  /**
   * Runs `run` aside in `scope` when the task has a check, so a slow script does not hold up
   * other due tasks; otherwise runs it in place.
   */
  readonly runsAside: (
    taskId: ScheduledTaskId,
    scope: Scope.Scope,
  ) => <E>(run: Effect.Effect<unknown, E>) => Effect.Effect<unknown, E>;
  readonly list: Effect.Effect<ReadonlyArray<ScheduledTaskCheckState>, CheckScriptError>;
  /** A person's save approves the script as saved; an agent's waits for a person. */
  readonly set: (input: {
    readonly taskId: ScheduledTaskId;
    readonly check: ScheduledTaskCheck | null;
    readonly by: CheckAuthor;
  }) => Effect.Effect<ScheduledTaskCheckState | null, CheckScriptError>;
  /** Approves the task's check only while it still hashes to `sha256`. No MCP tool reaches this. */
  readonly approve: (input: {
    readonly taskId: ScheduledTaskId;
    readonly sha256: string;
  }) => Effect.Effect<void, CheckScriptError>;
  /** Reports from now on, for the notification service; subscribed when this runs. */
  readonly subscribeReports: Effect.Effect<Stream.Stream<CheckReport>, never, Scope.Scope>;
}

const unavailable = new CheckScriptError({ reason: "Check scripts are not available here." });

/**
 * A reference, so the scheduler reads it without a typed dependency: where no layer provides it
 * (upstream's scheduler tests), no task has a check and nothing runs.
 */
export class CheckScripts extends Context.Reference<CheckScriptsShape>(
  "t3/fork/checkScripts/CheckScripts",
  {
    defaultValue: () => ({
      gate: () => Effect.succeed(null),
      runsAside: () => (run) => run,
      list: Effect.succeed([]),
      set: () => Effect.fail(unavailable),
      approve: () => Effect.fail(unavailable),
      subscribeReports: Effect.succeed(Stream.empty),
    }),
  },
) {}

/** The `workflow_trust` address of a task's check: one approval per task, like one per file. */
const checkTrustPath = (taskId: string) => `scheduled-task-check:${taskId}`;

interface CheckRow {
  readonly task_id: string;
  readonly task_created_at: string;
  readonly interpreter: string;
  readonly script: string;
  readonly timeout_seconds: number;
  readonly report_only: number;
}

const toError = (reason: string) => () => new CheckScriptError({ reason });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const digester = yield* Digest.Digest;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const audit = yield* AuditLog.AuditLog;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const reports = yield* PubSub.unbounded<CheckReport>();

  const hashOf = (row: Pick<CheckRow, "interpreter" | "script">) =>
    digester
      .digest(Digest.sha256, new TextEncoder().encode(`${row.interpreter}\n${row.script}`))
      .pipe(Effect.orDie, Effect.map(Hex.encode));
  const approvalOf = (taskId: string) =>
    sql<{ readonly sha256: string }>`SELECT sha256 FROM workflow_trust
      WHERE path = ${checkTrustPath(taskId)}`.pipe(Effect.map((rows) => rows[0]?.sha256));
  const storeApproval = Effect.fn("CheckScripts.storeApproval")(function* (
    taskId: string,
    sha256: string,
  ) {
    const at = yield* Clock.currentTimeMillis;
    const file = checkTrustPath(taskId);
    yield* sql`INSERT INTO workflow_trust (path, sha256, source, approved_at)
      VALUES (${file}, ${sha256}, 'user', ${at})
      ON CONFLICT (path) DO UPDATE SET sha256 = excluded.sha256, source = excluded.source,
        approved_at = excluded.approved_at`;
    yield* audit.append({ kind: "check_script.approved", subject: taskId, detail: { sha256 } });
  });

  // Live tasks only: a check outlives neither its task nor a task recreated with the same id.
  const readRow = (taskId: string, createdAt?: string) =>
    sql<CheckRow>`SELECT c.* FROM scheduled_task_checks c
      JOIN scheduled_tasks t ON t.task_id = c.task_id AND t.created_at = c.task_created_at
      WHERE c.task_id = ${taskId}
        AND ${createdAt === undefined ? sql`1 = 1` : sql`c.task_created_at = ${createdAt}`}`.pipe(
      Effect.map((rows) => rows[0]),
    );

  const stateOf = Effect.fn("CheckScripts.stateOf")(function* (row: CheckRow) {
    const sha256 = yield* hashOf(row);
    return {
      taskId: row.task_id as ScheduledTaskId,
      interpreter: row.interpreter as CheckInterpreter,
      script: row.script,
      timeoutSeconds: row.timeout_seconds,
      reportOnly: row.report_only === 1,
      sha256,
      approved: (yield* approvalOf(row.task_id)) === sha256,
    } satisfies ScheduledTaskCheckState;
  });

  const resetFailureStreak = (task: CheckedTask) =>
    sql`UPDATE scheduled_tasks SET failure_streak = 0
      WHERE task_id = ${task.id} AND created_at = ${task.createdAt} AND failure_streak <> 0`;

  const report = (input: CheckReport) => PubSub.publish(reports, input).pipe(Effect.asVoid);

  const gate: CheckScriptsShape["gate"] = Effect.fn("CheckScripts.gate")(
    function* ({ task, prompt, trigger }) {
      const row = yield* readRow(task.id, task.createdAt);
      if (row === undefined) return null;
      const state = yield* stateOf(row);
      if (!state.approved) {
        yield* report({
          id: `check-approval:${task.id}:${state.sha256}`,
          title: "Check script needs approval",
          body: `${task.title}: review it in Settings > Scheduled tasks.`,
          projectId: task.projectId,
        });
        return { _tag: "Failed", error: CHECK_NEEDS_APPROVAL, counts: false } satisfies GateResult;
      }
      const project = yield* projects.get(task.projectId);
      if (Option.isNone(project)) {
        return {
          _tag: "Failed",
          error: "Check script not run: the task's project is gone.",
          counts: true,
        } satisfies GateResult;
      }
      const taskStateDir = path.join(
        stateDir,
        "check-state",
        task.id.replace(/[^A-Za-z0-9_-]/g, "_"),
      );
      yield* fileSystem.makeDirectory(taskStateDir, { recursive: true }).pipe(Effect.ignore);
      const firedAt = DateTime.formatIso(yield* DateTime.now);
      const result = yield* runCheckScript({
        interpreter: state.interpreter,
        script: state.script,
        cwd: project.value.workspaceRoot,
        timeoutSeconds: state.timeoutSeconds,
        env: {
          CMDECK_TASK_ID: task.id,
          CMDECK_TASK_TITLE: task.title,
          CMDECK_PROJECT_DIR: project.value.workspaceRoot,
          CMDECK_STATE_DIR: taskStateDir,
          CMDECK_FIRED_AT: firedAt,
          CMDECK_TRIGGER: trigger,
          CMDECK_PREVIOUS_RUN_AT: task.lastRunAt ?? "",
          CMDECK_PREVIOUS_RUN_STATUS: task.lastRunStatus === "never" ? "" : task.lastRunStatus,
        },
      }).pipe(Effect.provideService(ProcessRunner.ProcessRunner, runner));
      const verdict = verdictOf(result);
      if (verdict === "error") {
        const error = failureMessage(result, state.timeoutSeconds);
        const stderr = result.stderr.trim();
        yield* report({
          title: `Check failed: ${task.title}`,
          body: stderr === "" ? error : `${error}\n\n${clip(stderr, 1000)}`,
          projectId: task.projectId,
        });
        return { _tag: "Failed", error, counts: true } satisfies GateResult;
      }
      if (verdict === "skip") {
        yield* resetFailureStreak(task);
        return { _tag: "Done" } satisfies GateResult;
      }
      if (state.reportOnly) {
        yield* resetFailureStreak(task);
        const output = result.stdout.trim();
        yield* report({
          title: task.title,
          body: output === "" ? "The check script found something." : output,
          projectId: task.projectId,
        });
        return { _tag: "Done" } satisfies GateResult;
      }
      return {
        _tag: "Wake",
        prompt: promptWithCheckOutput(prompt, result.stdout, PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
      } satisfies GateResult;
    },
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
    (effect, { task }) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.as(
            Effect.logWarning("Could not run a scheduled task's check script", {
              taskId: task.id,
              cause,
            }),
            {
              _tag: "Failed",
              error: "The check script could not be run.",
              counts: true,
            } satisfies GateResult,
          ),
        ),
      ),
  );

  const runsAside: CheckScriptsShape["runsAside"] = (taskId, scope) => (run) =>
    readRow(taskId).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap((row) =>
        row === undefined
          ? run
          : run.pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Scheduled task run failed", { taskId, cause }),
              ),
              Effect.forkIn(scope),
            ),
      ),
    );

  const list: CheckScriptsShape["list"] = sql<CheckRow>`SELECT c.* FROM scheduled_task_checks c
      JOIN scheduled_tasks t ON t.task_id = c.task_id AND t.created_at = c.task_created_at
      ORDER BY c.task_id`.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, stateOf)),
    Effect.mapError(toError("Could not read check scripts.")),
    Effect.withSpan("CheckScripts.list"),
  );

  const set: CheckScriptsShape["set"] = Effect.fn("CheckScripts.set")(
    function* ({ taskId, check, by }) {
      const [task] = yield* sql<{ readonly created_at: string }>`SELECT created_at
        FROM scheduled_tasks WHERE task_id = ${taskId}`;
      if (task === undefined) {
        return yield* new CheckScriptError({ reason: "That scheduled task does not exist." });
      }
      if (check === null) {
        yield* sql`DELETE FROM scheduled_task_checks WHERE task_id = ${taskId}`;
        yield* sql`DELETE FROM workflow_trust WHERE path = ${checkTrustPath(taskId)}`;
        return null;
      }
      const row: CheckRow = {
        task_id: taskId,
        task_created_at: task.created_at,
        interpreter: check.interpreter,
        script: check.script,
        timeout_seconds: check.timeoutSeconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS,
        report_only: check.reportOnly === true ? 1 : 0,
      };
      const updatedAt = yield* Clock.currentTimeMillis;
      yield* sql`INSERT INTO scheduled_task_checks ${sql.insert({ ...row, updated_at: updatedAt })}
        ON CONFLICT (task_id) DO UPDATE SET task_created_at = excluded.task_created_at,
          interpreter = excluded.interpreter, script = excluded.script,
          timeout_seconds = excluded.timeout_seconds, report_only = excluded.report_only,
          updated_at = excluded.updated_at`;
      const state = yield* stateOf(row);
      yield* audit.append({
        kind: "check_script.saved",
        subject: taskId,
        detail: { sha256: state.sha256, by },
      });
      if (by === "user" && !state.approved) {
        yield* storeApproval(taskId, state.sha256);
        return { ...state, approved: true };
      }
      return state;
    },
    Effect.mapError((cause) =>
      cause._tag === "CheckScriptError"
        ? cause
        : new CheckScriptError({ reason: "Could not save the check script." }),
    ),
  );

  const approve: CheckScriptsShape["approve"] = Effect.fn("CheckScripts.approve")(
    function* ({ taskId, sha256 }) {
      const row = yield* readRow(taskId);
      if (row === undefined) {
        return yield* new CheckScriptError({ reason: "That task has no check script." });
      }
      if ((yield* hashOf(row)) !== sha256) {
        return yield* new CheckScriptError({
          reason: "The check script changed after it was shown. Review it again before approving.",
        });
      }
      yield* storeApproval(taskId, sha256);
    },
    Effect.mapError((cause) =>
      cause._tag === "CheckScriptError"
        ? cause
        : new CheckScriptError({ reason: "Could not approve the check script." }),
    ),
  );

  const service: CheckScriptsShape = {
    gate,
    runsAside,
    list,
    set,
    approve,
    subscribeReports: PubSub.subscribe(reports).pipe(Effect.map(Stream.fromSubscription)),
  };
  return service;
});

/** With the caller's process runner, so tests pass a fake one. */
export const layerWithRunner = Layer.effect(CheckScripts, make).pipe(
  Layer.provide(AuditLog.layerService),
);

/** Beneath orchestration, which the scheduler reads it from. */
export const layer = layerWithRunner.pipe(Layer.provide(ProcessRunner.layer));
