import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Idempotent; called from `ForkSchema.ts`. One check per scheduled task, matched by the task's
 * creation time so a task recreated with the same id does not inherit it. Approvals live in
 * `workflow_trust`, keyed by `checkTrustPath`.
 */
export const ensureCheckScriptsSchema = Effect.fn("ensureCheckScriptsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS scheduled_task_checks (
    task_id TEXT PRIMARY KEY,
    task_created_at TEXT NOT NULL,
    interpreter TEXT NOT NULL,
    script TEXT NOT NULL,
    timeout_seconds INTEGER NOT NULL,
    report_only INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`;
});
