// Fork-only. Connects chat apps as notification channels and binds their chats to threads (WI-3.01).
import {
  MESSAGING_SENDER_ID_PATTERN,
  type MessagingChat,
  type MessagingConnectInput,
  MessagingError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as AuditLog from "../audit/AuditLog.ts";
import * as Notifications from "../notifications/Notifications.ts";
import { ServerSecretStore } from "../secrets/EncryptedSecretStore.ts";
import { isTelegramToken } from "./telegram.ts";

export interface BindInput {
  readonly channelId: string;
  readonly chatId: string;
  readonly threadId: string;
}

export class MessagingService extends Context.Service<
  MessagingService,
  {
    /** Stores the token as a secret and adds the bot as an enabled notification channel. */
    readonly connect: (input: MessagingConnectInput) => Effect.Effect<string, MessagingError>;
    readonly listChats: Effect.Effect<ReadonlyArray<MessagingChat>, MessagingError>;
    /** Inbound text in the chat becomes turns on the thread, at the thread's own modes. */
    readonly bind: (input: BindInput) => Effect.Effect<void, MessagingError>;
    readonly unbind: (input: {
      readonly channelId: string;
      readonly chatId: string;
    }) => Effect.Effect<void, MessagingError>;
  }
>()("t3/fork/messaging/MessagingService") {}

const TOKEN_CHECKS: Record<MessagingConnectInput["kind"], (token: string) => boolean> = {
  telegram: isTelegramToken,
};

const isMessagingError = Schema.is(MessagingError);
const fail = (reason: MessagingError["reason"]) => Effect.fail(new MessagingError({ reason }));
const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isMessagingError(cause) ? cause : new MessagingError({ reason: "unavailable", cause }),
    ),
  );

/** Trimmed, deduplicated sender ids; an invalid one refuses the whole list. */
const parseAllowlist = (ids: ReadonlyArray<string>) => {
  const cleaned = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
  if (cleaned.length === 0) return fail("empty_allowlist");
  if (!cleaned.every((id) => MESSAGING_SENDER_ID_PATTERN.test(id))) {
    return fail("invalid_sender_id");
  }
  return Effect.succeed(cleaned);
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const notifications = yield* Notifications.Notifications;

  const connect: MessagingService["Service"]["connect"] = (input) =>
    wrap(
      Effect.gen(function* () {
        const token = input.token.trim();
        if (!TOKEN_CHECKS[input.kind](token)) return yield* fail("invalid_token");
        const allowedUserIds = yield* parseAllowlist(input.allowedUserIds);
        const secretRef = `messaging-${input.kind}-${yield* random.uuidV4()}`;
        yield* secrets.set(secretRef, new TextEncoder().encode(token));
        const channelId = yield* notifications
          .addChannel({
            kind: input.kind,
            name: input.name.trim() || input.kind,
            config: { allowedUserIds },
            secretRef,
          })
          .pipe(Effect.tapError(() => secrets.remove(secretRef).pipe(Effect.ignore)));
        yield* AuditLog.note({
          kind: "messaging.connected",
          subject: channelId,
          detail: { channelKind: input.kind, allowedSenders: allowedUserIds.length },
        });
        return channelId;
      }),
    ).pipe(Effect.withSpan("MessagingService.connect"));

  const listChats: MessagingService["Service"]["listChats"] = wrap(
    sql<{
      readonly channel_id: string;
      readonly channel_name: string;
      readonly chat_id: string;
      readonly label: string;
      readonly thread_id: string | null;
      readonly thread_title: string | null;
    }>`SELECT m.channel_id, c.name AS channel_name, m.chat_id, m.label, m.thread_id,
        t.title AS thread_title
      FROM messaging_chats m
      JOIN notification_channels c ON c.channel_id = m.channel_id
      LEFT JOIN orchestration_v2_projection_threads t
        ON t.thread_id = m.thread_id AND t.deleted_at IS NULL
      ORDER BY c.created_at, m.label, m.chat_id`,
  ).pipe(
    Effect.map((rows) =>
      rows.map((row): MessagingChat => ({
        channelId: row.channel_id,
        channelName: row.channel_name,
        chatId: row.chat_id,
        label: row.label,
        threadId: row.thread_id,
        threadTitle: row.thread_title,
      })),
    ),
    Effect.withSpan("MessagingService.listChats"),
  );

  const bind: MessagingService["Service"]["bind"] = (input) =>
    wrap(
      Effect.gen(function* () {
        const [thread] = yield* sql<{ readonly thread_id: string }>`SELECT thread_id
            FROM orchestration_v2_projection_threads
            WHERE thread_id = ${input.threadId} AND deleted_at IS NULL AND archived_at IS NULL`;
        if (thread === undefined) return yield* fail("thread_not_found");
        const updated = yield* sql<{ readonly chat_id: string }>`UPDATE messaging_chats
            SET thread_id = ${input.threadId}, updated_at = ${yield* Clock.currentTimeMillis}
            WHERE channel_id = ${input.channelId} AND chat_id = ${input.chatId}
            RETURNING chat_id`;
        if (updated.length === 0) return yield* fail("chat_not_found");
        yield* AuditLog.note({
          kind: "messaging.bound",
          subject: input.channelId,
          detail: { chatId: input.chatId, threadId: input.threadId },
        });
      }),
    ).pipe(Effect.withSpan("MessagingService.bind"));

  const unbind: MessagingService["Service"]["unbind"] = (input) =>
    wrap(
      Effect.gen(function* () {
        const updated = yield* sql<{ readonly chat_id: string }>`UPDATE messaging_chats
            SET thread_id = NULL, updated_at = ${yield* Clock.currentTimeMillis}
            WHERE channel_id = ${input.channelId} AND chat_id = ${input.chatId}
            RETURNING chat_id`;
        if (updated.length === 0) return yield* fail("chat_not_found");
        yield* AuditLog.note({
          kind: "messaging.unbound",
          subject: input.channelId,
          detail: { chatId: input.chatId },
        });
      }),
    ).pipe(Effect.withSpan("MessagingService.unbind"));

  return MessagingService.of({ connect, listChats, bind, unbind });
});

export const layer = Layer.effect(MessagingService, make);
