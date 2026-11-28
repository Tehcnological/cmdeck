import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as SqlClient from "effect/sql/SqlClient";

// `seq` aliases the rowid so VACUUM cannot renumber rows under the external-content FTS index.
export const ensureMemorySchema = Effect.fn("ensureMemorySchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS memory_items (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    provenance TEXT NOT NULL,
    status TEXT NOT NULL,
    origin_thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_memory_items_scope_status
    ON memory_items(scope, status)`;
  yield* sql`CREATE TABLE IF NOT EXISTS memory_revisions (
    item_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    actor TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, revision)
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS thread_memory_mode (
    thread_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS memory_injections (
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    injected_at TEXT NOT NULL,
    PRIMARY KEY (run_id, item_id)
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_memory_injections_thread
    ON memory_injections(thread_id, injected_at)`;
  // One vector per item, kept apart so items never carry a stale one. `signature` names the
  // embedder; a row with another signature is re-embedded before it is used.
  yield* sql`CREATE TABLE IF NOT EXISTS memory_embeddings (
    item_id TEXT PRIMARY KEY,
    signature TEXT NOT NULL,
    vector BLOB NOT NULL,
    embedded_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS memory_embeddings_stale
    AFTER UPDATE OF content ON memory_items BEGIN
    DELETE FROM memory_embeddings WHERE item_id = old.id;
  END`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS memory_embeddings_delete AFTER DELETE ON memory_items BEGIN
    DELETE FROM memory_embeddings WHERE item_id = old.id;
  END`;
  // As in migration 069: a SQLite build without FTS5 leaves search empty instead of failing startup.
  const created = yield* sql`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    content = 'memory_items',
    content_rowid = 'seq',
    tokenize = 'porter unicode61 remove_diacritics 2'
  )`.pipe(
    Effect.as(true),
    Effect.catchIf(
      (cause) =>
        Predicate.hasProperty(cause.reason.cause, "errcode") && cause.reason.cause.errcode === 1,
      (cause) =>
        Effect.logWarning(
          "Memory search index unavailable; memory search finds nothing.",
          cause,
        ).pipe(Effect.as(false)),
    ),
  );
  if (!created) return;
  yield* sql`CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_items BEGIN
    INSERT INTO memory_fts (rowid, content) VALUES (new.seq, new.content);
  END`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_items BEGIN
    INSERT INTO memory_fts (memory_fts, rowid, content) VALUES ('delete', old.seq, old.content);
  END`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE OF content ON memory_items BEGIN
    INSERT INTO memory_fts (memory_fts, rowid, content) VALUES ('delete', old.seq, old.content);
    INSERT INTO memory_fts (rowid, content) VALUES (new.seq, new.content);
  END`;
});
