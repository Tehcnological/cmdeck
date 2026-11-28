// Pin rules (per-thread cap, redact-then-cut preview, idempotent pin, redact again on read) ported
// from Kiro Crew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/dashboard/chat_pins.py
// (Apache-2.0). Changed: SQLite rows keyed by thread and message instead of a JSON file, unpin by
// message only, no per-app ownership, and the preview comes from the stored message, not the client.
import {
  MESSAGE_PIN_PREVIEW_LENGTH,
  MESSAGE_PINS_PER_THREAD,
  MessagePin,
  type MessagePinInput,
  MessagePinsError,
  type MessageUnpinInput,
  type ThreadId,
} from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";

const decodePins = Schema.decodeUnknownSync(Schema.Array(MessagePin));

/**
 * Redacts the whole text before trimming or cutting, so no secret is cut below its pattern and no
 * collapsed match ahead of one can pull an unredacted fragment into the preview.
 */
export const pinPreview = (text: string): string =>
  redactSecrets(text).trim().slice(0, MESSAGE_PIN_PREVIEW_LENGTH);

export class MessagePins extends Context.Service<
  MessagePins,
  {
    /** The thread's pins, oldest first. */
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<MessagePin>, MessagePinsError>;
    /** Pins a finished user or agent message of the thread. Pinning it again returns its pin. */
    readonly pin: (input: MessagePinInput) => Effect.Effect<MessagePin, MessagePinsError>;
    /** Unpinning a message that is not pinned succeeds. */
    readonly unpin: (input: MessageUnpinInput) => Effect.Effect<void, MessagePinsError>;
  }
>()("t3/fork/messagePins/MessagePins") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const unavailable = Effect.mapError(
    (cause: unknown) => new MessagePinsError({ reason: "unavailable", cause }),
  );
  const select = (threadId: ThreadId, messageId?: string) =>
    sql`SELECT thread_id AS "threadId", message_id AS "messageId", role, preview,
        pinned_at AS "pinnedAt"
      FROM message_pins
      WHERE thread_id = ${threadId} ${messageId === undefined ? sql`` : sql`AND message_id = ${messageId}`}
      ORDER BY pinned_at, message_id`.pipe(
      unavailable,
      // Stored previews may predate the current patterns, so they are redacted again on the way out.
      Effect.map((rows) =>
        decodePins(rows).map((pin) => ({ ...pin, preview: redactSecrets(pin.preview) })),
      ),
    );

  const list = Effect.fn("MessagePins.list")(function* (threadId: ThreadId) {
    return yield* select(threadId);
  });

  const pin = Effect.fn("MessagePins.pin")(function* (input: MessagePinInput) {
    const message = (yield* projection
      .getMessagesById(input.threadId, [input.messageId])
      .pipe(unavailable)).get(input.messageId);
    if (
      message === undefined ||
      message.streaming ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return yield* new MessagePinsError({ reason: "not-found" });
    }
    const pinnedAt = yield* Clock.currentTimeMillis;
    // One statement, so two clients pinning at once cannot pass the cap together.
    yield* sql`INSERT INTO message_pins (thread_id, message_id, role, preview, pinned_at)
      SELECT ${input.threadId}, ${input.messageId}, ${message.role}, ${pinPreview(message.text)},
        ${pinnedAt}
      WHERE (SELECT COUNT(*) FROM message_pins WHERE thread_id = ${input.threadId})
        < ${MESSAGE_PINS_PER_THREAD}
      ON CONFLICT (thread_id, message_id) DO NOTHING`.pipe(unavailable);
    const [pinned] = yield* select(input.threadId, input.messageId);
    if (pinned === undefined) return yield* new MessagePinsError({ reason: "limit" });
    return pinned;
  });

  const unpin = Effect.fn("MessagePins.unpin")(function* (input: MessageUnpinInput) {
    yield* sql`DELETE FROM message_pins
      WHERE thread_id = ${input.threadId} AND message_id = ${input.messageId}`.pipe(unavailable);
  });

  return MessagePins.of({ list, pin, unpin });
});

/** Reads messages through the projection store, which `ForkLayer` provides. */
export const layer = Layer.effect(MessagePins, make);
