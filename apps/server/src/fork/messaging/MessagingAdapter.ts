// Fork-only. What a chat app (Telegram, Slack, Teams) provides to the messaging service (WI-3.01).
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** A transport failure. `reason` is a short category, stored and shown after redaction. */
export class MessagingTransportError extends Schema.TaggedError<MessagingTransportError>()(
  "MessagingTransportError",
  { reason: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {
  override get message(): string {
    return `Messaging transport failed: ${this.reason}.`;
  }
}

export type InboundEvent =
  | {
      readonly type: "text";
      readonly chatId: string;
      readonly senderId: string;
      readonly senderName: string;
      /** Only private chats are served; a group's text is refused. */
      readonly isPrivate: boolean;
      readonly text: string;
    }
  | {
      /** A button press on a message the bot sent. */
      readonly type: "action";
      readonly actionId: string;
      readonly chatId: string;
      readonly senderId: string;
      readonly messageId: string;
      readonly data: string;
    };

export interface OutboundButton {
  readonly label: string;
  /** Opaque to the chat app and at most 64 bytes; the service maps it back server-side. */
  readonly data: string;
}

export interface OutboundMessage {
  readonly chatId: string;
  readonly text: string;
  /** One row of buttons each. */
  readonly buttons?: ReadonlyArray<ReadonlyArray<OutboundButton>> | undefined;
}

/** One connected bot. Every call is interruptible, so stopping a channel aborts its long poll. */
export interface MessagingAdapter {
  /** Waits for new events after `cursor` (null: whatever the app still holds). */
  readonly receive: (cursor: string | null) => Effect.Effect<
    {
      readonly events: ReadonlyArray<InboundEvent>;
      readonly cursor: string | null;
    },
    MessagingTransportError
  >;
  readonly send: (
    message: OutboundMessage,
  ) => Effect.Effect<{ readonly messageId: string }, MessagingTransportError>;
  /** Replaces a sent message's text and drops its buttons. */
  readonly edit: (
    chatId: string,
    messageId: string,
    text: string,
  ) => Effect.Effect<void, MessagingTransportError>;
  /** Answers a button press so the app stops its spinner, with an optional short toast. */
  readonly acknowledge: (
    actionId: string,
    text?: string,
  ) => Effect.Effect<void, MessagingTransportError>;
}
