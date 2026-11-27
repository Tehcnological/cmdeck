import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. */
export const ensureUsageAlertsSchema = Effect.fn("ensureUsageAlertsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The thresholds already told per account window, so a restart does not tell them again.
  yield* sql`CREATE TABLE IF NOT EXISTS usage_alert_windows (
    account_key TEXT NOT NULL,
    window_id TEXT NOT NULL,
    resets_at TEXT,
    told_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (account_key, window_id)
  )`;
});
