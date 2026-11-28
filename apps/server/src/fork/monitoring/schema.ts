import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. */
export const ensureMonitoringSchema = Effect.fn("ensureMonitoringSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A monitor loop is a scheduled task bound to its thread; this row holds its budget and memory.
  // `task_created_at` ties it to the task row, so a task recreated with the same id is not a loop.
  yield* sql`CREATE TABLE IF NOT EXISTS monitor_loops (
    task_id TEXT PRIMARY KEY,
    task_created_at TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    every_ms INTEGER NOT NULL,
    max_cycles INTEGER NOT NULL,
    cycles INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    stop_sentinel TEXT,
    last_output_hash TEXT,
    stopped_reason TEXT,
    stopped_at INTEGER,
    created_at INTEGER NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS monitor_loops_thread_idx ON monitor_loops(thread_id)`;
  // Runs an agent closed with nothing_to_report: no one is notified about them.
  yield* sql`CREATE TABLE IF NOT EXISTS quiet_turns (
    thread_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, run_id)
  )`;
  // The last known state of each heartbeat check, so a restart does not alert again.
  yield* sql`CREATE TABLE IF NOT EXISTS heartbeat_checks (
    check_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    up INTEGER NOT NULL,
    since INTEGER NOT NULL,
    checked_at INTEGER NOT NULL,
    detail TEXT
  )`;
});
