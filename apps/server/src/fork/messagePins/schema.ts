import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. Keyed by thread, never an orchestration event. */
export const ensureMessagePinsSchema = Effect.fn("ensureMessagePinsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS message_pins (
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL,
    preview TEXT NOT NULL,
    pinned_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, message_id)
  )`;
});
