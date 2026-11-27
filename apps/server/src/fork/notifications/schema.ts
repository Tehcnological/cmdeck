import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. */
export const ensureNotificationsSchema = Effect.fn("ensureNotificationsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `secret_ref` names a stored secret; channel modules resolve it when they send.
  yield* sql`CREATE TABLE IF NOT EXISTS notification_channels (
    channel_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    secret_ref TEXT,
    rules_json TEXT NOT NULL,
    rate_limit_per_hour INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`;
  // One row per message per channel; the key is the dedupe (a milestone id or an alert id).
  yield* sql`CREATE TABLE IF NOT EXISTS notification_outbox (
    channel_id TEXT NOT NULL,
    dedupe_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    project_id TEXT,
    thread_id TEXT,
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    last_error TEXT,
    delivered_at INTEGER,
    failed_at INTEGER,
    PRIMARY KEY (channel_id, dedupe_id)
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
    ON notification_outbox(next_attempt_at) WHERE delivered_at IS NULL AND failed_at IS NULL`;
});
