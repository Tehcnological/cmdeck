import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** One consent per decision point and project; `project_id` '' covers every project. */
export const ensureDecisionsSchema = Effect.fn("ensureDecisionsSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS decision_consents (
    point TEXT NOT NULL,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    PRIMARY KEY (point, project_id)
  )`;
});
