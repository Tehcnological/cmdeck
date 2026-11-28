import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. One approval per file: other bytes there are not approved. */
export const ensureWorkflowTrustSchema = Effect.fn("ensureWorkflowTrustSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS workflow_trust (
    path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    source TEXT NOT NULL,
    approved_at INTEGER NOT NULL
  )`;
});
