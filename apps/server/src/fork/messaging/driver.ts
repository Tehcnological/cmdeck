// Fork-only. Turns a MessagingAdapter into a notification channel that also listens (WI-3.01).
// Deny-on-silence approvals bound to one request, and the 5-minute window and 1-30 s poll backoff,
// follow Kiro Crew@b75544f0 src/kiro_crew/messaging/approval.py and telegram/client_polling.py
// (Apache-2.0); rewritten for button callbacks mapped server-side instead of typed replies.
import {
  type AuditDetailValue,
  CommandId,
  MessageId,
  MessagingError,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { MENTION } from "../../scheduledTasks/webhookTemplate.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import {
  needsInputRequestId,
  type NotificationChannelDriver,
  type NotificationChannelTarget,
  NotificationDeliveryError,
  type NotificationMessage,
} from "../notifications/Notifications.ts";
import { ServerSecretStore } from "../secrets/EncryptedSecretStore.ts";
import type { InboundEvent, MessagingAdapter, OutboundButton } from "./MessagingAdapter.ts";

/** An unanswered approval prompt is declined after this long: silence never approves. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 30_000;
const FAILURES_BEFORE_WARNING = 3;
/** Size cap on the text a message becomes, after the mention breaker lengthened it. */
const MAX_TURN_TEXT = 8_000;
const MAX_REPLY_TEXT = 3_000;
const MAX_PROMPT_TEXT = 1_000;
const BIND_CHOICES = 8;
const TITLE_CHARS = 40;

const APPROVE = "ok:";
const DENY = "no:";
const BIND = "bind:";

const HELP = [
  "Messages here become turns on the bound CMDeck thread.",
  "/bind picks the thread, /unbind stops forwarding.",
  "Approval requests from that thread arrive with Approve and Deny buttons; no answer within 5 minutes denies.",
].join("\n");

/** What the service does to threads. Tests pass a fake; the server uses ThreadManagementService. */
export interface MessagingThreads {
  readonly send: (threadId: string, text: string) => Effect.Effect<void, MessagingError>;
  readonly respond: (
    threadId: string,
    requestId: string,
    decision: "accept" | "decline",
  ) => Effect.Effect<void, MessagingError>;
}

const threadsPort = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;
  const sql = yield* SqlClient.SqlClient;
  const unavailable = () => new MessagingError({ reason: "unavailable" });
  return {
    send: Effect.fn("Messaging.sendToThread")(
      function* (threadId: string, text: string) {
        const [row] = yield* sql<{ readonly project_id: string }>`SELECT project_id
            FROM orchestration_v2_projection_threads
            WHERE thread_id = ${threadId} AND deleted_at IS NULL AND archived_at IS NULL`;
        if (row === undefined) return yield* new MessagingError({ reason: "thread_not_found" });
        yield* threads.sendToThread({
          projectId: ProjectId.make(row.project_id),
          commandId: CommandId.make(`messaging:${yield* random.uuidV4()}`),
          threadId: ThreadId.make(threadId),
          messageId: MessageId.make(yield* random.uuidV4()),
          text,
          attachments: [],
          mode: "auto",
          createdBy: "user",
          creationSource: "server",
        });
      },
      Effect.mapError((error) => (isMessagingError(error) ? error : unavailable())),
    ),
    respond: Effect.fn("Messaging.respond")(function* (
      threadId: string,
      requestId: string,
      decision: "accept" | "decline",
    ) {
      yield* threads.dispatch({
        type: "runtime-request.respond",
        commandId: CommandId.make(`messaging:${yield* random.uuidV4()}`),
        threadId: ThreadId.make(threadId),
        requestId: RuntimeRequestId.make(requestId),
        decision,
      });
    }, Effect.mapError(unavailable)),
  } satisfies MessagingThreads;
});

const isMessagingError = Schema.is(MessagingError);
const ChannelConfig = Schema.Struct({ allowedUserIds: Schema.Array(Schema.String) });
const decodeConfig = Schema.decodeUnknownOption(ChannelConfig);

const allowlist = (target: NotificationChannelTarget) =>
  new Set(
    Option.match(decodeConfig(target.config), {
      onNone: () => [],
      onSome: (config) => config.allowedUserIds,
    }),
  );

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Untrusted chat text entering a prompt: mentions broken, then the whole text capped. */
const toTurnText = (text: string) => clip(text.trim().replace(MENTION, "$&⁠"), MAX_TURN_TEXT);

const commandOf = (text: string) => {
  const match = /^\/([a-z]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  return match === null ? null : match[1]!.toLowerCase();
};

const backoffMs = (failures: number) => Math.min(1000 * 2 ** (failures - 1), BACKOFF_MAX_MS);

interface ThreadRow {
  readonly thread_id: string;
  readonly title: string;
}

/**
 * The channel module for one chat app. Nothing runs until `reconcile` hands it an enabled
 * channel; then one listener per channel long-polls until the channel is disabled or deleted.
 */
export const makeDriverWith = Effect.fn("Messaging.makeDriver")(function* (
  kind: string,
  connect: (token: string) => MessagingAdapter,
  threads: MessagingThreads,
) {
  const sql = yield* SqlClient.SqlClient;
  const secrets = yield* ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const listeners = yield* FiberMap.make<string>();

  const audit = (
    event: string,
    channel: NotificationChannelTarget,
    detail: Readonly<Record<string, AuditDetailValue>>,
  ) =>
    AuditLog.note({
      kind: `messaging.${event}`,
      actor: kind,
      subject: channel.id,
      detail: { channelKind: kind, ...detail },
    });

  const adapterFor = Effect.fn("Messaging.adapterFor")(
    function* (channel: NotificationChannelTarget) {
      const stored =
        channel.secretRef === null ? Option.none() : yield* secrets.get(channel.secretRef);
      if (Option.isNone(stored)) return yield* Effect.fail("bot token missing");
      return connect(new TextDecoder().decode(stored.value));
    },
    Effect.mapError(() => "bot token missing"),
  );

  const threadTitle = (threadId: string) =>
    sql<ThreadRow>`SELECT thread_id, title FROM orchestration_v2_projection_threads
        WHERE thread_id = ${threadId} AND deleted_at IS NULL AND archived_at IS NULL`.pipe(
      Effect.map((rows) => rows[0] ?? null),
    );

  const recentThreads = sql<ThreadRow>`SELECT thread_id, title
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL AND archived_at IS NULL
        AND COALESCE(json_extract(payload_json, '$.lineage.relationshipToParent'), '') <> 'subagent'
      ORDER BY updated_at DESC LIMIT ${BIND_CHOICES}`;

  /** The prompt of a request still waiting for an approval, or null when there is none. */
  const pendingApproval = (threadId: string, requestId: string) =>
    sql<{ readonly prompt: string | null }>`SELECT
          (SELECT json_extract(i.payload_json, '$.prompt')
            FROM orchestration_v2_projection_turn_items i
            WHERE i.thread_id = r.thread_id AND i.type = 'approval_request'
              AND json_extract(i.payload_json, '$.requestId') = r.runtime_request_id
            LIMIT 1) AS prompt
        FROM orchestration_v2_projection_runtime_requests r
        WHERE r.thread_id = ${threadId} AND r.runtime_request_id = ${requestId}
          AND r.status = 'pending'
          AND r.kind NOT IN ('user_input', 'mcp-elicitation', 'dynamic_tool_call', 'auth_refresh')`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : { prompt: rows[0].prompt ?? "" })),
    );

  const lastReply = (threadId: string) =>
    sql<{ readonly text: string | null }>`SELECT json_extract(payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${threadId} AND role = 'assistant' AND streaming = 0
        ORDER BY created_at DESC, message_id DESC LIMIT 1`.pipe(
      Effect.map((rows) => rows[0]?.text ?? null),
    );

  const rememberChat = (channelId: string, chatId: string, label: string, now: number) =>
    sql`INSERT INTO messaging_chats (channel_id, chat_id, label, thread_id, updated_at)
        VALUES (${channelId}, ${chatId}, ${label}, NULL, ${now})
        ON CONFLICT (channel_id, chat_id) DO UPDATE SET label = excluded.label`;

  const boundThread = (channelId: string, chatId: string) =>
    sql<{ readonly thread_id: string | null }>`SELECT thread_id FROM messaging_chats
        WHERE channel_id = ${channelId} AND chat_id = ${chatId}`.pipe(
      Effect.map((rows) => rows[0]?.thread_id ?? null),
    );

  const onText = Effect.fn("Messaging.onText")(function* (
    channel: NotificationChannelTarget,
    adapter: MessagingAdapter,
    event: Extract<InboundEvent, { readonly type: "text" }>,
  ) {
    const now = yield* Clock.currentTimeMillis;
    yield* rememberChat(channel.id, event.chatId, clip(event.senderName, 80), now);
    const command = commandOf(event.text);
    yield* audit("inbound", channel, {
      chatId: event.chatId,
      senderId: event.senderId,
      command: command ?? "text",
      length: event.text.length,
    });
    const reply = (text: string, buttons?: ReadonlyArray<ReadonlyArray<OutboundButton>>) =>
      adapter.send({ chatId: event.chatId, text, buttons });
    if (command === "bind") {
      const choices = yield* recentThreads;
      if (choices.length === 0) return yield* reply("There are no threads to bind yet.");
      return yield* reply(
        "Which thread should this chat drive?",
        choices.map((thread) => [
          { label: clip(thread.title, TITLE_CHARS), data: `${BIND}${thread.thread_id}` },
        ]),
      );
    }
    if (command === "unbind") {
      yield* sql`UPDATE messaging_chats SET thread_id = NULL, updated_at = ${now}
          WHERE channel_id = ${channel.id} AND chat_id = ${event.chatId}`;
      return yield* reply("Unbound. Messages here no longer reach a thread.");
    }
    if (command !== null) return yield* reply(HELP);
    const threadId = yield* boundThread(channel.id, event.chatId);
    const thread = threadId === null ? null : yield* threadTitle(threadId);
    if (thread === null) return yield* reply("No thread is bound to this chat. Send /bind.");
    const sent = yield* threads.send(thread.thread_id, toTurnText(event.text)).pipe(Effect.result);
    yield* reply(
      Result.isSuccess(sent)
        ? `Sent to "${clip(thread.title, TITLE_CHARS)}".`
        : "Could not start a turn on that thread. Check it in CMDeck.",
    );
  });

  /** Claims every prompt of the request at once, so one answer wins and repeats see nothing. */
  const answer = Effect.fn("Messaging.answer")(function* (
    channel: NotificationChannelTarget,
    adapter: MessagingAdapter,
    event: Extract<InboundEvent, { readonly type: "action" }>,
    token: string,
    decision: "accept" | "decline",
  ) {
    const now = yield* Clock.currentTimeMillis;
    const [prompt] = yield* sql<{
      readonly thread_id: string;
      readonly request_id: string;
      readonly created_at: number;
    }>`SELECT thread_id, request_id, created_at FROM messaging_approvals
        WHERE token = ${token} AND channel_id = ${channel.id} AND chat_id = ${event.chatId}`;
    if (prompt === undefined || prompt.created_at <= now - APPROVAL_TIMEOUT_MS) {
      return yield* adapter.acknowledge(event.actionId, "This request is no longer open.");
    }
    const claimed = yield* sql<{
      readonly token: string;
      readonly channel_id: string;
      readonly chat_id: string;
      readonly message_id: string | null;
      readonly text: string;
    }>`UPDATE messaging_approvals SET resolved_at = ${now}, decision = ${decision}
        WHERE request_id = ${prompt.request_id} AND resolved_at IS NULL
        RETURNING token, channel_id, chat_id, message_id, text`;
    if (!claimed.some((row) => row.token === token)) {
      return yield* adapter.acknowledge(event.actionId, "Already answered.");
    }
    yield* audit("approval_answered", channel, {
      requestId: prompt.request_id,
      senderId: event.senderId,
      decision,
    });
    const responded = yield* threads
      .respond(prompt.thread_id, prompt.request_id, decision)
      .pipe(Effect.result);
    const outcome = Result.isFailure(responded)
      ? "Could not answer it; it may be settled in CMDeck already."
      : decision === "accept"
        ? "Approved from Telegram."
        : "Denied from Telegram.";
    yield* adapter.acknowledge(event.actionId, outcome);
    for (const row of claimed) {
      if (row.channel_id !== channel.id || row.message_id === null) continue;
      yield* adapter
        .edit(row.chat_id, row.message_id, `${row.text}\n\n${outcome}`)
        .pipe(Effect.ignore);
    }
  });

  const onAction = Effect.fn("Messaging.onAction")(function* (
    channel: NotificationChannelTarget,
    adapter: MessagingAdapter,
    event: Extract<InboundEvent, { readonly type: "action" }>,
  ) {
    const button = event.data.startsWith(BIND)
      ? "bind"
      : event.data.startsWith(APPROVE)
        ? "approve"
        : event.data.startsWith(DENY)
          ? "deny"
          : "unknown";
    yield* audit("inbound", channel, {
      chatId: event.chatId,
      senderId: event.senderId,
      command: `button:${button}`,
    });
    if (button === "approve" || button === "deny") {
      return yield* answer(
        channel,
        adapter,
        event,
        event.data.slice(APPROVE.length),
        button === "approve" ? "accept" : "decline",
      );
    }
    if (button === "bind") {
      const thread = yield* threadTitle(event.data.slice(BIND.length));
      if (thread === null) return yield* adapter.acknowledge(event.actionId, "Thread not found.");
      const now = yield* Clock.currentTimeMillis;
      yield* sql`UPDATE messaging_chats SET thread_id = ${thread.thread_id}, updated_at = ${now}
          WHERE channel_id = ${channel.id} AND chat_id = ${event.chatId}`;
      yield* audit("bound", channel, { chatId: event.chatId, threadId: thread.thread_id });
      yield* adapter.acknowledge(event.actionId, "Bound.");
      return yield* adapter
        .edit(event.chatId, event.messageId, `Bound to "${clip(thread.title, TITLE_CHARS)}".`)
        .pipe(Effect.ignore);
    }
    yield* adapter.acknowledge(event.actionId, "This button is no longer valid.");
  });

  /** Silence denies: prompts past their window are claimed and their requests declined. */
  const expire = Effect.fn("Messaging.expire")(function* (
    channel: NotificationChannelTarget,
    adapter: MessagingAdapter,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const expired = yield* sql<{
      readonly channel_id: string;
      readonly chat_id: string;
      readonly thread_id: string;
      readonly request_id: string;
      readonly message_id: string | null;
      readonly text: string;
    }>`UPDATE messaging_approvals SET resolved_at = ${now}, decision = 'decline'
        WHERE resolved_at IS NULL AND request_id IN (
          SELECT request_id FROM messaging_approvals
          WHERE channel_id = ${channel.id} AND resolved_at IS NULL
            AND created_at <= ${now - APPROVAL_TIMEOUT_MS})
        RETURNING channel_id, chat_id, thread_id, request_id, message_id, text`;
    const outcomes = new Map<string, string>();
    for (const row of expired) {
      if (outcomes.has(row.request_id)) continue;
      const pending = yield* pendingApproval(row.thread_id, row.request_id);
      if (pending === null) {
        outcomes.set(row.request_id, "Answered elsewhere.");
        continue;
      }
      const declined = yield* threads
        .respond(row.thread_id, row.request_id, "decline")
        .pipe(Effect.result);
      yield* audit("approval_expired", channel, {
        requestId: row.request_id,
        declined: Result.isSuccess(declined),
      });
      outcomes.set(row.request_id, "No answer in time, so it was denied.");
    }
    for (const row of expired) {
      if (row.channel_id !== channel.id || row.message_id === null) continue;
      yield* adapter
        .edit(row.chat_id, row.message_id, `${row.text}\n\n${outcomes.get(row.request_id)}`)
        .pipe(Effect.ignore);
    }
  });

  const listen = Effect.fn("Messaging.listen")(
    function* (channel: NotificationChannelTarget) {
      const allowed = allowlist(channel);
      if (allowed.size === 0) {
        yield* audit("listen_refused", channel, { reason: "empty allowlist" });
        return yield* Effect.logWarning("Messaging channel has no allowed senders; not listening", {
          channelId: channel.id,
        });
      }
      const adapter = yield* adapterFor(channel);
      const [stored] = yield* sql<{ readonly cursor: string | null }>`SELECT cursor
          FROM messaging_cursors WHERE channel_id = ${channel.id}`;
      let cursor = stored?.cursor ?? null;
      let failures = 0;
      for (;;) {
        const batch = yield* adapter.receive(cursor).pipe(Effect.result);
        if (Result.isFailure(batch)) {
          failures += 1;
          if (failures === FAILURES_BEFORE_WARNING) {
            yield* Effect.logWarning("Messaging channel cannot reach its chat app", {
              channelId: channel.id,
              reason: redactSecrets(batch.failure.reason),
            });
          }
          yield* Effect.sleep(backoffMs(failures));
          continue;
        }
        failures = 0;
        for (const event of batch.success.events) {
          const refused =
            !allowed.has(event.senderId) ||
            (event.type === "text" ? !event.isPrivate : event.chatId !== event.senderId);
          if (refused) {
            // No reply: a stranger learns nothing, not even that the bot is listening.
            yield* audit("inbound_refused", channel, {
              chatId: event.chatId,
              senderId: event.senderId,
            });
            continue;
          }
          yield* (
            event.type === "text"
              ? onText(channel, adapter, event)
              : onAction(channel, adapter, event)
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Messaging could not handle an update", { cause }),
            ),
          );
        }
        if (batch.success.cursor !== cursor) {
          cursor = batch.success.cursor;
          yield* sql`INSERT INTO messaging_cursors (channel_id, cursor) VALUES (${channel.id}, ${cursor})
              ON CONFLICT (channel_id) DO UPDATE SET cursor = excluded.cursor`;
        }
        yield* expire(channel, adapter);
      }
    },
    (effect, channel) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Messaging listener stopped", { channelId: channel.id, cause }),
        ),
      ),
  );

  const reconcile = Effect.fn("Messaging.reconcile")(
    function* (enabled: ReadonlyArray<NotificationChannelTarget>) {
      const wanted = new Set(enabled.map((channel) => channel.id));
      for (const [channelId] of Array.from(listeners)) {
        if (!wanted.has(channelId)) yield* FiberMap.remove(listeners, channelId);
      }
      for (const channel of enabled) {
        yield* FiberMap.run(listeners, channel.id, listen(channel), { onlyIfMissing: true });
      }
    },
    Effect.catchCause((cause) => Effect.logWarning("Messaging reconcile failed", { cause })),
  );

  /** Outbound notifications reach every chat that has talked to the bot; bound chats get more. */
  const send = Effect.fn("Messaging.send")(
    function* (channel: NotificationChannelTarget, message: NotificationMessage) {
      const adapter = yield* adapterFor(channel);
      const chats = yield* sql<{
        readonly chat_id: string;
        readonly thread_id: string | null;
      }>`SELECT chat_id, thread_id FROM messaging_chats WHERE channel_id = ${channel.id}
          ORDER BY chat_id`;
      if (chats.length === 0) return yield* Effect.fail("no chat yet; send /start to the bot");
      const requestId = needsInputRequestId(message);
      for (const chat of chats) {
        let text = `${message.title}\n${message.body}`;
        const bound = chat.thread_id !== null && chat.thread_id === message.threadId;
        if (bound && message.kind === "thread.run_settled") {
          const reply = yield* lastReply(chat.thread_id!);
          if (reply !== null && reply.trim() !== "") {
            text += `\n\n${clip(redactSecrets(reply.trim()), MAX_REPLY_TEXT)}`;
          }
        }
        const approval =
          bound && requestId !== null ? yield* pendingApproval(chat.thread_id!, requestId) : null;
        if (approval === null) {
          yield* adapter.send({ chatId: chat.chat_id, text });
          continue;
        }
        if (approval.prompt !== "") {
          text += `\n\n${clip(redactSecrets(approval.prompt), MAX_PROMPT_TEXT)}`;
        }
        text += "\n\nNo answer within 5 minutes denies it.";
        const token = (yield* random.uuidV4()).replaceAll("-", "");
        // One prompt per request and chat; a retried delivery does not ask twice.
        const created = yield* sql`INSERT OR IGNORE INTO messaging_approvals ${sql.insert({
          token,
          channel_id: channel.id,
          chat_id: chat.chat_id,
          thread_id: chat.thread_id!,
          request_id: requestId!,
          text,
          created_at: yield* Clock.currentTimeMillis,
        })} RETURNING token`;
        if (created.length === 0) continue;
        const sent = yield* adapter
          .send({
            chatId: chat.chat_id,
            text,
            buttons: [
              [
                { label: "Approve", data: `${APPROVE}${token}` },
                { label: "Deny", data: `${DENY}${token}` },
              ],
            ],
          })
          .pipe(
            // An unsent prompt asks again on the retry instead of being skipped.
            Effect.tapError(() =>
              sql`DELETE FROM messaging_approvals WHERE token = ${token}`.pipe(Effect.ignore),
            ),
          );
        yield* sql`UPDATE messaging_approvals SET message_id = ${sent.messageId}
            WHERE token = ${token}`;
      }
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(
          (error) =>
            new NotificationDeliveryError({
              reason: typeof error === "string" ? error : redactSecrets(error.message),
            }),
        ),
      ),
  );

  const removed = Effect.fn("Messaging.removed")(
    function* (channel: NotificationChannelTarget) {
      if (channel.secretRef !== null) yield* secrets.remove(channel.secretRef).pipe(Effect.ignore);
      yield* sql`DELETE FROM messaging_chats WHERE channel_id = ${channel.id}`;
      yield* sql`DELETE FROM messaging_approvals WHERE channel_id = ${channel.id}`;
      yield* sql`DELETE FROM messaging_cursors WHERE channel_id = ${channel.id}`;
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not clear a messaging channel", { cause }),
    ),
  );

  return {
    kind,
    send,
    reconcile,
    removed,
  } satisfies NotificationChannelDriver;
});

export const makeDriver = (kind: string, connect: (token: string) => MessagingAdapter) =>
  Effect.flatMap(threadsPort, (threads) => makeDriverWith(kind, connect, threads));
