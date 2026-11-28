// Fork-only. A Telegram Bot API adapter over long polling: no inbound port, no SDK (WI-3.01).
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import {
  type InboundEvent,
  type MessagingAdapter,
  MessagingTransportError,
} from "./MessagingAdapter.ts";
import { makeDriver } from "./driver.ts";

/** Seconds Telegram holds a getUpdates call open when nothing arrives. */
const LONG_POLL_SECONDS = 25;
const CALL_TIMEOUT = "40 seconds";
/** Telegram rejects longer message text. */
const MAX_TEXT = 4096;

/** One Bot API method call, answering its `result`. Tests replace it with a fake. */
export type TelegramCall = (
  method: string,
  params: Readonly<Record<string, unknown>>,
) => Effect.Effect<unknown, MessagingTransportError>;

const Reply = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  description: Schema.optionalKey(Schema.String),
});
const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(Reply));

/** The real transport. The token sits in the URL path, so no error here carries the request. */
export const httpCall =
  (client: HttpClient.HttpClient, token: string): TelegramCall =>
  (method, params) =>
    client
      .execute(
        HttpClientRequest.post(`https://api.telegram.org/bot${token}/${method}`).pipe(
          HttpClientRequest.bodyJsonUnsafe(params),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.text, (body) => ({ status: response.status, body })),
        ),
        Effect.timeout(CALL_TIMEOUT),
        Effect.mapError(() => new MessagingTransportError({ reason: "Telegram is unreachable" })),
        Effect.flatMap(({ status, body }) => {
          const reply = decodeReply(body);
          if (Option.isSome(reply) && reply.value.ok) return Effect.succeed(reply.value.result);
          const said = Option.isSome(reply) ? reply.value.description : undefined;
          return Effect.fail(
            new MessagingTransportError({
              reason: said === undefined ? `Telegram answered ${status}` : `Telegram: ${said}`,
            }),
          );
        }),
      );

const User = Schema.Struct({
  id: Schema.Number,
  first_name: Schema.optionalKey(Schema.String),
  username: Schema.optionalKey(Schema.String),
});
const Chat = Schema.Struct({ id: Schema.Number, type: Schema.String });
const Update = Schema.Struct({
  update_id: Schema.Number,
  message: Schema.optionalKey(
    Schema.Struct({
      message_id: Schema.Number,
      from: Schema.optionalKey(User),
      chat: Chat,
      text: Schema.optionalKey(Schema.String),
    }),
  ),
  callback_query: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      from: User,
      data: Schema.optionalKey(Schema.String),
      message: Schema.optionalKey(Schema.Struct({ message_id: Schema.Number, chat: Chat })),
    }),
  ),
});
const decodeUpdate = Schema.decodeUnknownOption(Update);
const decodeSent = Schema.decodeUnknownOption(Schema.Struct({ message_id: Schema.Number }));

/** A malformed update costs only itself; the cursor still moves past it. */
const toEvent = (update: typeof Update.Type): InboundEvent | null => {
  const { message, callback_query: query } = update;
  if (message !== undefined && message.from !== undefined && message.text !== undefined) {
    return {
      type: "text",
      chatId: String(message.chat.id),
      senderId: String(message.from.id),
      senderName: message.from.username ?? message.from.first_name ?? String(message.from.id),
      isPrivate: message.chat.type === "private",
      text: message.text,
    };
  }
  if (query !== undefined && query.data !== undefined && query.message !== undefined) {
    return {
      type: "action",
      actionId: query.id,
      chatId: String(query.message.chat.id),
      senderId: String(query.from.id),
      messageId: String(query.message.message_id),
      data: query.data,
    };
  }
  return null;
};

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);

export const makeTelegramAdapter = (call: TelegramCall): MessagingAdapter => ({
  receive: (cursor) =>
    call("getUpdates", {
      ...(cursor === null ? {} : { offset: Number(cursor) }),
      timeout: LONG_POLL_SECONDS,
      allowed_updates: ["message", "callback_query"],
    }).pipe(
      Effect.map((result) => {
        const raw = Array.isArray(result) ? result : [];
        let next = cursor === null ? null : Number(cursor);
        const events: Array<InboundEvent> = [];
        for (const item of raw) {
          const update = decodeUpdate(item);
          if (Option.isNone(update)) continue;
          next = Math.max(next ?? 0, update.value.update_id + 1);
          const event = toEvent(update.value);
          if (event !== null) events.push(event);
        }
        return { events, cursor: next === null ? null : String(next) };
      }),
    ),
  send: (message) =>
    call("sendMessage", {
      chat_id: message.chatId,
      text: clip(message.text),
      ...(message.buttons === undefined
        ? {}
        : {
            reply_markup: {
              inline_keyboard: message.buttons.map((row) =>
                row.map((button) => ({ text: button.label, callback_data: button.data })),
              ),
            },
          }),
    }).pipe(
      Effect.map((result) => ({
        messageId: Option.match(decodeSent(result), {
          onNone: () => "",
          onSome: (sent) => String(sent.message_id),
        }),
      })),
    ),
  // Without reply_markup, the edit removes the message's buttons.
  edit: (chatId, messageId, text) =>
    call("editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text: clip(text),
    }).pipe(Effect.asVoid),
  acknowledge: (actionId, text) =>
    call("answerCallbackQuery", {
      callback_query_id: actionId,
      ...(text === undefined ? {} : { text }),
    }).pipe(Effect.asVoid),
});

/** Telegram's channel module, listed in `notifications/drivers.ts`. Inert until a channel is on. */
export const driver = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  return yield* makeDriver("telegram", (token) => makeTelegramAdapter(httpCall(client, token)));
});

/** Bot tokens look like `123456:ABC...`; checked before one is stored. */
export const isTelegramToken = (token: string) => /^\d{3,20}:[\w-]{30,100}$/.test(token);
