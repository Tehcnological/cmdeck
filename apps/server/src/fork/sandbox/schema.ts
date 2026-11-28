import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Who runs in a container: `kind` 'project' or 'thread'. A thread's row overrides its project's. */
export const ensureSandboxSchema = Effect.fn("ensureSandboxSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS sandbox_modes (
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, target_id)
  )`;
  // One row: the container recipe. Absent means the defaults, with no image (containers off).
  yield* sql`CREATE TABLE IF NOT EXISTS sandbox_recipe (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    recipe_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
});
