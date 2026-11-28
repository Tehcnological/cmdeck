import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Idempotent; called from `ForkSchema.ts`. Channels themselves are notification channels. */
export const ensureMessagingSchema = Effect.fn("ensureMessagingSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A private chat with an allowed sender, and the thread its text drives.
  yield* sql`CREATE TABLE IF NOT EXISTS messaging_chats (
    channel_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    label TEXT NOT NULL,
    thread_id TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (channel_id, chat_id)
  )`;
  // One approval prompt per request and chat. Buttons carry only `token`, so a press maps back
  // here and cannot name another request; `resolved_at` is claimed once per request.
  yield* sql`CREATE TABLE IF NOT EXISTS messaging_approvals (
    token TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    text TEXT NOT NULL,
    message_id TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    decision TEXT,
    UNIQUE (channel_id, chat_id, request_id)
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_messaging_approvals_open
    ON messaging_approvals(request_id) WHERE resolved_at IS NULL`;
  // The /bind picker's choices. A button carries only `token`: Telegram caps callback data at
  // 64 bytes, which a thread id can exceed, and a press can only pick what this chat was offered.
  yield* sql`CREATE TABLE IF NOT EXISTS messaging_bind_choices (
    token TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    thread_id TEXT NOT NULL
  )`;
  // Where each channel's long poll resumes after a restart.
  yield* sql`CREATE TABLE IF NOT EXISTS messaging_cursors (
    channel_id TEXT PRIMARY KEY,
    cursor TEXT
  )`;
});
