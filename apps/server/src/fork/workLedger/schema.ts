import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Conductor columns (title through worker_thread_id) and worker columns (status through
 * reported_at) are written by separate statements in WorkLedger.ts, never by one.
 */
export const ensureWorkLedgerSchema = Effect.fn("ensureWorkLedgerSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    conductor_thread_id TEXT NOT NULL,
    title TEXT NOT NULL,
    acceptance TEXT NOT NULL,
    state TEXT NOT NULL,
    decision TEXT,
    worker_thread_id TEXT,
    status TEXT,
    summary TEXT,
    artifacts_json TEXT NOT NULL DEFAULT '{}',
    pr INTEGER,
    reported_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_work_items_conductor
    ON work_items(conductor_thread_id, created_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_work_items_worker
    ON work_items(worker_thread_id) WHERE worker_thread_id IS NOT NULL`;
  yield* sql`CREATE TABLE IF NOT EXISTS work_conductors (
    thread_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL
  )`;
});
