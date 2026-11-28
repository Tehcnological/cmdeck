import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { httpCall, isTelegramToken, makeTelegramAdapter, type TelegramCall } from "./telegram.ts";

const TOKEN = ["123456", "B".repeat(35)].join(":");

const fakeCall = (results: Record<string, unknown>) => {
  const calls: Array<{ readonly method: string; readonly params: unknown }> = [];
  const call: TelegramCall = (method, params) =>
    Effect.sync(() => {
      calls.push({ method, params });
      return results[method];
    });
  return { calls, call };
};

it.effect("receive turns updates into events, skips malformed ones and advances the cursor", () =>
  Effect.gen(function* () {
    const { calls, call } = fakeCall({
      getUpdates: [
        {
          update_id: 10,
          message: {
            message_id: 1,
            from: { id: 42, first_name: "Ada", username: "ada" },
            chat: { id: 42, type: "private" },
            text: "hi",
          },
        },
        { update_id: 11, message: "not an object" },
        {
          update_id: 12,
          callback_query: {
            id: "cb-1",
            from: { id: 42 },
            data: "ok:abc",
            message: { message_id: 5, chat: { id: 42, type: "private" } },
          },
        },
        // A sticker: no text, nothing to handle, but the cursor still moves past it.
        {
          update_id: 13,
          message: { message_id: 2, from: { id: 42 }, chat: { id: 42, type: "private" } },
        },
      ],
    });
    const result = yield* makeTelegramAdapter(call).receive("9");
    expect(calls[0]).toEqual({
      method: "getUpdates",
      params: { offset: 9, timeout: 25, allowed_updates: ["message", "callback_query"] },
    });
    expect(result.cursor).toBe("14");
    expect(result.events).toEqual([
      {
        type: "text",
        chatId: "42",
        senderId: "42",
        senderName: "ada",
        isPrivate: true,
        text: "hi",
      },
      {
        type: "action",
        actionId: "cb-1",
        chatId: "42",
        senderId: "42",
        messageId: "5",
        data: "ok:abc",
      },
    ]);
  }),
);

it.effect("send adds an inline keyboard and clips text to Telegram's limit", () =>
  Effect.gen(function* () {
    const { calls, call } = fakeCall({ sendMessage: { message_id: 77 } });
    const adapter = makeTelegramAdapter(call);
    const sent = yield* adapter.send({
      chatId: "42",
      text: "x".repeat(5000),
      buttons: [[{ label: "Approve", data: "ok:t" }]],
    });
    expect(sent).toEqual({ messageId: "77" });
    const params = calls[0]?.params as { text: string; reply_markup: unknown };
    expect(params.text).toHaveLength(4096);
    expect(params.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Approve", callback_data: "ok:t" }]],
    });
    yield* adapter.edit("42", "77", "done");
    yield* adapter.acknowledge("cb-1", "Bound.");
    expect(calls.slice(1)).toEqual([
      { method: "editMessageText", params: { chat_id: "42", message_id: 77, text: "done" } },
      { method: "answerCallbackQuery", params: { callback_query_id: "cb-1", text: "Bound." } },
    ]);
  }),
);

it.effect("the HTTP transport reports Telegram's refusal without the token", () =>
  Effect.gen(function* () {
    const urls: Array<string> = [];
    const client = HttpClient.make((request) => {
      urls.push(request.url);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ ok: false, description: "Unauthorized" }, { status: 401 }),
        ),
      );
    });
    const error = yield* httpCall(client, TOKEN)("getMe", {}).pipe(
      Effect.as(null),
      Effect.catch(Effect.succeed),
    );
    expect(urls).toEqual([`https://api.telegram.org/bot${TOKEN}/getMe`]);
    expect(error?.reason).toBe("Telegram: Unauthorized");
    expect(error?.message).not.toContain(TOKEN);
  }),
);

it("accepts only the shape BotFather issues", () => {
  expect(isTelegramToken(TOKEN)).toBe(true);
  expect(isTelegramToken("123456")).toBe(false);
  expect(isTelegramToken(`${TOKEN} extra`)).toBe(false);
});
