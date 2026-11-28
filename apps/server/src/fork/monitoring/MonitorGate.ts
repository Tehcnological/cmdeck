// Fork-only. A monitor loop's decision on each due run (WI-2.12). It sits right after the task's
// check script, by wrapping the CheckScripts gate the scheduler already calls, so the scheduler
// needs no hook of its own: a skip or stop ends the run with no turn, a wake adds the loop note.
import type { ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as CheckScripts from "../checkScripts/CheckScripts.ts";
import { decideWake } from "../decisions/points/wakeSuppression.ts";
import { decide, type LoopDecision, type StopReason, wakeNote } from "./decide.ts";

export interface LoopRow {
  readonly task_id: string;
  readonly task_created_at: string;
  readonly thread_id: string;
  readonly mode: "interval" | "idle";
  readonly every_ms: number;
  readonly max_cycles: number;
  readonly cycles: number;
  readonly expires_at: number;
  readonly stop_sentinel: string | null;
  readonly last_output_hash: string | null;
  readonly stopped_reason: string | null;
}

export interface StoppedLoop {
  readonly taskId: ScheduledTaskId;
  readonly threadId: ThreadId;
  readonly reason: StopReason;
}

type GateInput = Parameters<CheckScripts.CheckScriptsShape["gate"]>[0];
type GateResult = CheckScripts.GateResult | null;

export class MonitorGate extends Context.Service<
  MonitorGate,
  {
    /** Decides a due run of a monitor loop task after its check; any other task passes through. */
    readonly gate: (input: GateInput, checked: GateResult) => Effect.Effect<GateResult>;
    /** Loops the gate ended from now on, so their tasks can be removed; subscribed when this runs. */
    readonly subscribeStopped: Effect.Effect<Stream.Stream<StoppedLoop>, never, Scope.Scope>;
  }
>()("t3/fork/monitoring/MonitorGate") {}

const ACTIVE_RUN = ["preparing", "queued", "starting", "running", "waiting"];
const millis = (iso: string | null) => (iso === null ? null : Date.parse(iso));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const digester = yield* Digest.Digest;
  const stopped = yield* PubSub.unbounded<StoppedLoop>();
  const hashOf = (text: string) =>
    digester
      .digest(Digest.sha256, new TextEncoder().encode(text))
      .pipe(Effect.orDie, Effect.map(Hex.encode));

  const threadState = Effect.fn("MonitorGate.threadState")(function* (threadId: string) {
    const [thread] = yield* sql<{
      readonly archived_at: string | null;
      readonly deleted_at: string | null;
    }>`SELECT archived_at, deleted_at FROM orchestration_v2_projection_threads
      WHERE thread_id = ${threadId}`;
    const [run] = yield* sql<{
      readonly status: string;
      readonly completed_at: string | null;
    }>`SELECT status, completed_at FROM orchestration_v2_projection_runs
      WHERE thread_id = ${threadId} ORDER BY ordinal DESC LIMIT 1`;
    return {
      thread:
        thread === undefined || thread.deleted_at !== null
          ? ("gone" as const)
          : thread.archived_at !== null
            ? ("archived" as const)
            : ("live" as const),
      busy: run !== undefined && ACTIVE_RUN.includes(run.status),
      lastSettledAt: run === undefined ? null : millis(run.completed_at),
    };
  });

  const stop = Effect.fn("MonitorGate.stop")(function* (row: LoopRow, reason: StopReason) {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`UPDATE monitor_loops SET stopped_reason = COALESCE(stopped_reason, ${reason}),
      stopped_at = COALESCE(stopped_at, ${now}) WHERE task_id = ${row.task_id}`;
    // Paused at once, so it cannot fire again even if removing it fails.
    yield* sql`UPDATE scheduled_tasks SET enabled = 0
      WHERE task_id = ${row.task_id} AND created_at = ${row.task_created_at}`;
    yield* PubSub.publish(stopped, {
      taskId: row.task_id as ScheduledTaskId,
      threadId: row.thread_id as ThreadId,
      reason: row.stopped_reason === null ? reason : "stopped",
    });
  });

  const gate: MonitorGate["Service"]["gate"] = Effect.fn("MonitorGate.gate")(
    function* (input, checked) {
      const [row] = yield* sql<LoopRow>`SELECT * FROM monitor_loops
        WHERE task_id = ${input.task.id} AND task_created_at = ${input.task.createdAt}`;
      if (row === undefined) return checked;
      const now = yield* Clock.currentTimeMillis;
      const outputHash = checked?._tag === "Wake" ? yield* hashOf(checked.prompt) : null;
      const decision: LoopDecision = decide(
        {
          mode: row.mode,
          everyMs: row.every_ms,
          maxCycles: row.max_cycles,
          cycles: row.cycles,
          expiresAt: row.expires_at,
          lastOutputHash: row.last_output_hash,
          stoppedReason: row.stopped_reason,
        },
        {
          now,
          manual: input.trigger === "manual",
          ...(yield* threadState(row.thread_id)),
          check:
            checked === null
              ? "none"
              : checked._tag === "Wake"
                ? "wake"
                : checked._tag === "Done"
                  ? "done"
                  : "failed",
          outputHash,
        },
      );
      if (decision._tag === "PassThrough") return checked;
      if (decision._tag === "Skip") return { _tag: "Done" } as const;
      if (decision._tag === "Stop") {
        yield* stop(row, decision.reason);
        return { _tag: "Done" } as const;
      }
      // The optional decision model may hold back a wake on a check's output; never end the loop.
      if (checked?._tag === "Wake" && input.trigger !== "manual") {
        const wake = yield* decideWake({
          projectId: input.task.projectId,
          instruction: input.prompt,
          evidence: checked.prompt,
          failing: false,
          ending: decision.last,
        });
        if (wake === "delay") {
          yield* sql`UPDATE monitor_loops SET last_output_hash = ${outputHash}
            WHERE task_id = ${row.task_id}`;
          return { _tag: "Done" } as const;
        }
      }
      // Conditional on the count read, so two runs racing past the gate spend one wake each.
      const spent = yield* sql`UPDATE monitor_loops SET cycles = cycles + 1,
          last_output_hash = ${outputHash ?? row.last_output_hash}
        WHERE task_id = ${row.task_id} AND cycles = ${row.cycles} AND stopped_reason IS NULL
        RETURNING cycles`;
      if (spent.length === 0) return { _tag: "Done" } as const;
      const note = wakeNote({
        cycle: row.cycles + 1,
        maxCycles: row.max_cycles,
        expiresAt: row.expires_at,
        sentinel: row.stop_sentinel,
        last: decision.last,
      });
      return {
        _tag: "Wake",
        prompt: `${checked?._tag === "Wake" ? checked.prompt : input.prompt}\n\n${note}`,
      } as const;
    },
    (effect, input, checked) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Monitor loop decision failed; the run goes on as checked", {
            taskId: input.task.id,
            cause,
          }).pipe(Effect.as(checked)),
        ),
      ),
  );

  return MonitorGate.of({
    gate,
    subscribeStopped: PubSub.subscribe(stopped).pipe(Effect.map(Stream.fromSubscription)),
  });
});

export const layer = Layer.effect(MonitorGate, make);

/** The check scripts the scheduler reads, with each loop's decision after the check. */
export const checkScriptsLayer = Layer.effect(
  CheckScripts.CheckScripts,
  Effect.gen(function* () {
    const checks = yield* CheckScripts.CheckScripts;
    const loops = yield* MonitorGate;
    return {
      ...checks,
      gate: Effect.fn("CheckScripts.gate.withLoops")(function* (input: GateInput) {
        return yield* loops.gate(input, yield* checks.gate(input));
      }),
    };
  }),
);
