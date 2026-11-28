import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as SqlClient from "effect/sql/SqlClient";

// `seq` aliases the rowid so VACUUM cannot renumber chunks under the external-content FTS index.
export const ensureKnowledgeSchema = Effect.fn("ensureKnowledgeSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS knowledge_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    indexed_at TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    UNIQUE (project_id, path)
  )`;
  // One row per indexed file: size and mtime spot a change cheaply, the hash confirms it.
  yield* sql`CREATE TABLE IF NOT EXISTS knowledge_files (
    source_id TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (source_id, rel_path)
  )`;
  yield* sql`CREATE TABLE IF NOT EXISTS knowledge_chunks (
    seq INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    content TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file
    ON knowledge_chunks(source_id, rel_path)`;
  // A vector per chunk from the memory embedder; `signature` names it, as in memory_embeddings.
  yield* sql`CREATE TABLE IF NOT EXISTS knowledge_vectors (
    chunk_seq INTEGER PRIMARY KEY,
    signature TEXT NOT NULL,
    vector BLOB NOT NULL
  )`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS knowledge_vectors_delete
    AFTER DELETE ON knowledge_chunks BEGIN
    DELETE FROM knowledge_vectors WHERE chunk_seq = old.seq;
  END`;
  // As in memory: a SQLite build without FTS5 leaves search empty instead of failing startup.
  const created = yield* sql`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    content,
    content = 'knowledge_chunks',
    content_rowid = 'seq',
    tokenize = 'porter unicode61 remove_diacritics 2'
  )`.pipe(
    Effect.as(true),
    Effect.catchIf(
      (cause) =>
        Predicate.hasProperty(cause.reason.cause, "errcode") && cause.reason.cause.errcode === 1,
      (cause) =>
        Effect.logWarning(
          "Knowledge search index unavailable; knowledge search finds nothing.",
          cause,
        ).pipe(Effect.as(false)),
    ),
  );
  if (!created) return;
  // Chunks are only ever inserted and deleted, never updated in place.
  yield* sql`CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
    INSERT INTO knowledge_fts (rowid, content) VALUES (new.seq, new.content);
  END`;
  yield* sql`CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
    INSERT INTO knowledge_fts (knowledge_fts, rowid, content) VALUES ('delete', old.seq, old.content);
  END`;
});
