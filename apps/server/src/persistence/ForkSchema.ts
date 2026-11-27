import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { ensureAuditSchema } from "../fork/audit/schema.ts";
import { ensureWorkflowTrustSchema } from "../fork/workflowTrust/schema.ts";
import { ensureNotificationsSchema } from "../fork/notifications/schema.ts";
import { ensureMemorySchema } from "../fork/memory/schema.ts";
import { ensureDecisionsSchema } from "../fork/decisions/schema.ts";
import { ensureBotsSchema } from "../fork/bots/schema.ts";

// Fork-only tables stay outside the numbered ledger: the migrator skips every id at or below the
// highest recorded one, so a fork id would make later upstream migrations silently never run.
// Everything here must be idempotent and safe to leave behind if the database returns to upstream.
export const ensureForkSchema = Effect.fn("ensureForkSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS inference_requests (
    request_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    model TEXT NOT NULL,
    thread_id TEXT,
    run_id TEXT,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    queue_wait_ms INTEGER,
    ttft_ms INTEGER,
    decode_ms INTEGER,
    duration_ms INTEGER,
    prompt_tokens INTEGER,
    cached_prompt_tokens INTEGER,
    completion_tokens INTEGER,
    parent_run_id TEXT,
    fallback_from TEXT,
    static_prefix_hash TEXT,
    failure_cause TEXT,
    upstream_http_status INTEGER,
    reasoning_tokens INTEGER
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_inference_requests_received
    ON inference_requests(received_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_inference_requests_thread
    ON inference_requests(thread_id, received_at) WHERE thread_id IS NOT NULL`;
  yield* sql`CREATE TABLE IF NOT EXISTS auth_pairing_requests (
    pairing_link_id TEXT PRIMARY KEY,
    requested_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    proof_key_thumbprint TEXT,
    client_json TEXT,
    approved_at TEXT
  )`;
  yield* ensureAuditSchema();
  yield* ensureWorkflowTrustSchema();
  yield* ensureNotificationsSchema();
  yield* ensureMemorySchema();
  yield* ensureDecisionsSchema();
  yield* ensureBotsSchema();
  // Failed runs in a row of a scheduled task, which pauses the task at a limit.
  const taskColumns = yield* sql<{ name: string }>`PRAGMA table_info(scheduled_tasks)`;
  if (!taskColumns.some((column) => column.name === "failure_streak")) {
    yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN failure_streak INTEGER NOT NULL DEFAULT 0`;
  }
});
