import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const ensureBotsSchema = Effect.fn("ensureBotsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // `deleted_state_json` holds what deleting paused and retired, so restoring undoes exactly that.
  yield* sql`CREATE TABLE IF NOT EXISTS bot_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL UNIQUE,
    model_selection_json TEXT NOT NULL,
    runtime_mode TEXT NOT NULL,
    channel_bindings_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    deleted_state_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
});

export interface ActiveBotRow {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
}

/** The live bot whose thread this is, if any. Memory and the turn context both key off it. */
export const activeBotForThread = (sql: SqlClient.SqlClient, threadId: ThreadId) =>
  sql<ActiveBotRow>`SELECT id, name, instructions FROM bot_profiles
    WHERE thread_id = ${threadId} AND status = 'active'`.pipe(Effect.map((rows) => rows[0]));
