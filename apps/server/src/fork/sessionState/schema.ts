import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. One card per thread, never an orchestration event. */
export const ensureSessionStateSchema = Effect.fn("ensureSessionStateSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS session_state_cards (
    thread_id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    phase TEXT NOT NULL,
    next_step TEXT NOT NULL,
    tried_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    injected_at TEXT
  )`;
});
