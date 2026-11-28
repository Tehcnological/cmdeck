import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Idempotent; called from `ForkSchema.ts`. Each thread an event-triggered run went to, so what
 * happens there never triggers an event task again, across restarts too.
 */
export const ensureEventTriggersSchema = Effect.fn("ensureEventTriggersSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS event_trigger_threads (
    thread_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
});
