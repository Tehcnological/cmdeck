import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts` and by the importer before it writes its event. */
export const ensureAuditSchema = Effect.fn("ensureAuditSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `seq` is assigned by the log, not SQLite, because each row's hash covers it.
  yield* sql`CREATE TABLE IF NOT EXISTS audit_events (
    seq INTEGER PRIMARY KEY,
    occurred_at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    actor TEXT,
    subject TEXT,
    detail_json TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_audit_events_occurred ON audit_events(occurred_at)`;
});
