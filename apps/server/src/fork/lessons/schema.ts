import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Where each thread's last lesson pass stopped: the newest message it read and the count then. */
export const ensureLessonsSchema = Effect.fn("ensureLessonsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS lesson_threads (
    thread_id TEXT PRIMARY KEY,
    through TEXT,
    message_count INTEGER NOT NULL,
    consolidated_at TEXT NOT NULL
  )`;
});
