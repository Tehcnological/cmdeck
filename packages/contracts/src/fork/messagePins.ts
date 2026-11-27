import * as Schema from "effect/Schema";

import { MessageId, ThreadId } from "../baseSchemas.ts";

/** Pins a thread may hold, from Kiro Crew's chat pins. */
export const MESSAGE_PINS_PER_THREAD = 50;
/** The stored preview's length; longer text is cut after redaction. */
export const MESSAGE_PIN_PREVIEW_LENGTH = 200;
const MESSAGE_PIN_PREVIEW_INPUT_LENGTH = 4_096;
// Provider message IDs nest and re-encode their thread and turn IDs, as citations allow.
const MESSAGE_PIN_MAX_ID_LENGTH = 4_096;

export const MessagePinRole = Schema.Literals(["user", "assistant"]);
export type MessagePinRole = typeof MessagePinRole.Type;

/** A message a person pinned in its thread. Fork table, not an orchestration event. */
export const MessagePin = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: MessagePinRole,
  /** The message's opening, redacted and cut to `MESSAGE_PIN_PREVIEW_LENGTH`. */
  preview: Schema.String,
  pinnedAt: Schema.Number,
});
export type MessagePin = typeof MessagePin.Type;

export const MessagePinsListInput = Schema.Struct({ threadId: ThreadId });
export type MessagePinsListInput = typeof MessagePinsListInput.Type;

export const MessagePinInput = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId.check(Schema.isMaxLength(MESSAGE_PIN_MAX_ID_LENGTH)),
  role: MessagePinRole,
  preview: Schema.String.check(Schema.isMaxLength(MESSAGE_PIN_PREVIEW_INPUT_LENGTH)),
});
export type MessagePinInput = typeof MessagePinInput.Type;

export const MessageUnpinInput = Schema.Struct({ threadId: ThreadId, messageId: MessageId });
export type MessageUnpinInput = typeof MessageUnpinInput.Type;

export class MessagePinsError extends Schema.TaggedError<MessagePinsError>()("MessagePinsError", {
  reason: Schema.Literals(["limit", "unavailable"]),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason === "limit"
      ? `A thread holds at most ${MESSAGE_PINS_PER_THREAD} pins. Unpin one first.`
      : "Pins could not be read or saved.";
  }
}
