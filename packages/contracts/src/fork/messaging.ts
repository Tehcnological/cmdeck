import * as Schema from "effect/Schema";

/** Chat apps a messaging channel can be; each is a notification channel kind too. */
export const MessagingKind = Schema.Literals(["telegram"]);
export type MessagingKind = typeof MessagingKind.Type;

/** Telegram user ids are positive integers; kept as text so no id loses precision. */
export const MESSAGING_SENDER_ID_PATTERN = /^\d{1,20}$/;

export const MessagingConnectInput = Schema.Struct({
  kind: MessagingKind,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  /** The bot token. Stored in the server's secret store; the channel keeps only its name. */
  token: Schema.String.check(Schema.isMaxLength(200)),
  /** Sender ids allowed to talk to the bot. An empty list is refused. */
  allowedUserIds: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
});
export type MessagingConnectInput = typeof MessagingConnectInput.Type;

/** A private chat with an allowed sender; inbound text there becomes turns on `threadId`. */
export const MessagingChat = Schema.Struct({
  channelId: Schema.String,
  channelName: Schema.String,
  chatId: Schema.String,
  /** The sender's display name, as the chat app gave it. */
  label: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  threadTitle: Schema.NullOr(Schema.String),
});
export type MessagingChat = typeof MessagingChat.Type;

export const MessagingChatInput = Schema.Struct({
  channelId: Schema.String,
  chatId: Schema.String,
});
export type MessagingChatInput = typeof MessagingChatInput.Type;

export const MessagingErrorReason = Schema.Literals([
  "empty_allowlist",
  "invalid_sender_id",
  "invalid_token",
  "chat_not_found",
  "thread_not_found",
  "unavailable",
]);
export type MessagingErrorReason = typeof MessagingErrorReason.Type;

export class MessagingError extends Schema.TaggedError<MessagingError>()("MessagingError", {
  reason: MessagingErrorReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return `Messaging: ${this.reason.replaceAll("_", " ")}.`;
  }
}
