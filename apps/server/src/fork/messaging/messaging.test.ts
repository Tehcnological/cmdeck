import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  MessagingError,
  MilestoneId,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as Notifications from "../notifications/Notifications.ts";
import { ServerSecretStore } from "../secrets/EncryptedSecretStore.ts";
import { makeDriverWith, type MessagingThreads } from "./driver.ts";
import type { InboundEvent, MessagingAdapter, OutboundMessage } from "./MessagingAdapter.ts";
import { MessagingService } from "./MessagingService.ts";
import * as Messaging from "./MessagingService.ts";

// Built from parts so no literal token sits in the source.
const TOKEN = ["123456", "A".repeat(35)].join(":");
const OWNER = "42";
const STRANGER = "7";
// Shaped like a ThreadLaunchService id (encoded project id + UUID): longer than Telegram's
// 64-byte callback data.
const THREAD = `thread:${"cHJvamVjdC0".repeat(5)}:0f8fad5b-d9cb-469f-a165-70867728950e`;

const text = (senderId: string, body: string, isPrivate = true): InboundEvent => ({
  type: "text",
  chatId: senderId,
  senderId,
  senderName: `user-${senderId}`,
  isPrivate,
  text: body,
});

let actions = 0;
const press = (data: string, senderId = OWNER): InboundEvent => ({
  type: "action",
  actionId: `action-${++actions}`,
  chatId: senderId,
  senderId,
  messageId: "1",
  data,
});

/** A chat app whose long poll waits on `inbox` and which records everything the bot says. */
const makeFake = Effect.gen(function* () {
  const inbox = yield* Queue.unbounded<ReadonlyArray<InboundEvent>>();
  const sent = yield* Queue.unbounded<OutboundMessage>();
  const acks = yield* Queue.unbounded<string | undefined>();
  const turns = yield* Queue.unbounded<{ readonly threadId: string; readonly text: string }>();
  const responses = yield* Queue.unbounded<{
    readonly requestId: string;
    readonly decision: string;
  }>();
  const state = { receives: 0, tokens: [] as Array<string>, edits: [] as Array<string> };
  let messageIds = 0;
  const adapter: MessagingAdapter = {
    receive: (cursor) =>
      Effect.sync(() => void (state.receives += 1)).pipe(
        Effect.andThen(Queue.take(inbox)),
        Effect.map((events) => ({ events, cursor: String(Number(cursor ?? 0) + 1) })),
      ),
    send: (message) =>
      Queue.offer(sent, message).pipe(Effect.as({ messageId: String(++messageIds) })),
    edit: (_chatId, _messageId, body) => Effect.sync(() => void state.edits.push(body)),
    acknowledge: (_actionId, body) => Queue.offer(acks, body).pipe(Effect.asVoid),
  };
  const threads: MessagingThreads = {
    send: (threadId, body) => Queue.offer(turns, { threadId, text: body }).pipe(Effect.asVoid),
    respond: (_threadId, requestId, decision) =>
      Queue.offer(responses, { requestId, decision }).pipe(Effect.asVoid),
  };
  return { inbox, sent, acks, turns, responses, state, adapter, threads };
});
type Fake = Effect.Success<typeof makeFake>;

const run = <A, E>(
  body: (
    fake: Fake,
  ) => Effect.Effect<
    A,
    E,
    | MessagingService
    | Notifications.Notifications
    | MilestoneHub.MilestoneHub
    | SqlClient.SqlClient
    | ServerSecretStore
  >,
) =>
  Effect.gen(function* () {
    const fake = yield* makeFake;
    const secrets = new Map<string, Uint8Array>();
    const notifications = Layer.unwrap(
      makeDriverWith(
        "telegram",
        (token) => {
          fake.state.tokens.push(token);
          return fake.adapter;
        },
        fake.threads,
      ).pipe(Effect.map((driver) => Notifications.layerWithDrivers([driver]))),
    );
    return yield* body(fake).pipe(
      Effect.provide(
        Messaging.layer.pipe(
          Layer.provideMerge(notifications),
          Layer.provideMerge(
            Layer.mock(ServerSecretStore)({
              get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
              set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
              remove: (name) => Effect.sync(() => void secrets.delete(name)),
            }),
          ),
          Layer.provideMerge(MilestoneHub.layer),
          Layer.provideMerge(AuditLog.layerService),
          Layer.provideMerge(Sqlite.layerMemory),
          Layer.provideMerge(NodeCrypto.layer),
        ),
      ),
    );
  });

const seedThread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title,
      default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
    VALUES (${THREAD}, 'project-1', 'Fix the build', 'codex', 'full-access', 'default',
      '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z', '{}')`;
});

const seedApproval = (requestId: string, prompt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_v2_projection_runtime_requests (runtime_request_id,
        thread_id, node_id, kind, status, created_at, payload_json)
      VALUES (${requestId}, ${THREAD}, 'node-1', 'command', 'pending',
        '2026-11-28T00:00:00.000Z', '{}')`;
    yield* sql`INSERT INTO orchestration_v2_projection_turn_items (turn_item_id, thread_id,
        node_id, ordinal, type, status, updated_at, payload_json)
      VALUES (${`item-${requestId}`}, ${THREAD}, 'node-1', 1, 'approval_request', 'pending',
        '2026-11-28T00:00:00.000Z', ${JSON.stringify({ requestId, prompt })})`;
    yield* (yield* MilestoneHub.MilestoneHub).publish({
      id: MilestoneId.make(`thread.needs_input:${requestId}`),
      occurredAt: "2026-11-28T00:00:00.000Z",
      projectId: ProjectId.make("project-1"),
      threadId: ThreadId.make(THREAD),
      parentThreadId: null,
      actor: { type: "agent" },
      isSubagentChild: false,
      type: "thread.needs_input",
      requestId: RuntimeRequestId.make(requestId),
      kind: "approval",
    });
  });

const connect = (allowedUserIds: ReadonlyArray<string> = [OWNER]) =>
  Effect.flatMap(MessagingService, (service) =>
    service.connect({ kind: "telegram", name: "Phone", token: TOKEN, allowedUserIds }),
  );

/** Connects and binds the owner's chat to the thread through the bot's own /bind picker. */
const connectAndBind = (fake: Fake) =>
  Effect.gen(function* () {
    yield* seedThread;
    const channelId = yield* connect();
    yield* Queue.offer(fake.inbox, [text(OWNER, "/bind")]);
    const picker = yield* Queue.take(fake.sent);
    const data = picker.buttons?.flat().map((button) => button.data) ?? [];
    expect(data).toHaveLength(1);
    expect(Buffer.byteLength(data[0]!)).toBeLessThanOrEqual(64);
    yield* Queue.offer(fake.inbox, [press(data[0]!)]);
    expect(yield* Queue.take(fake.acks)).toBe("Bound.");
    return channelId;
  });

const auditKinds = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly kind: string }>`SELECT kind FROM audit_events ORDER BY seq`;
  return rows.map((row) => row.kind);
});

it.effect("a stranger gets no reply and an audit row; the owner's text becomes a turn", () =>
  run((fake) =>
    Effect.gen(function* () {
      yield* connectAndBind(fake);
      expect(fake.state.tokens).toEqual([TOKEN]);

      yield* Queue.offer(fake.inbox, [
        text(STRANGER, "hello"),
        press(`bind:${THREAD}`, STRANGER),
        // The owner, but in a group where others would read the replies.
        text(OWNER, "in a group", false),
        text(OWNER, "check @secrets.env and run $deploy /ship"),
      ]);
      const turn = yield* Queue.take(fake.turns);
      expect(turn.threadId).toBe(THREAD);
      expect(turn.text).toBe("check @⁠secrets.env and run $⁠deploy /⁠ship");
      expect((yield* Queue.take(fake.sent)).text).toBe('Sent to "Fix the build".');
      // The only replies went to the owner's chat.
      expect(yield* Queue.size(fake.sent)).toBe(0);
      expect(yield* Queue.size(fake.acks)).toBe(0);
      expect(
        (yield* auditKinds).filter((kind) => kind === "messaging.inbound_refused"),
      ).toHaveLength(3);
    }),
  ),
);

it.effect("an approval button resolves exactly its request, once; a forged one resolves none", () =>
  run((fake) =>
    Effect.gen(function* () {
      yield* connectAndBind(fake);
      yield* seedApproval("request-1", "rm -rf build");
      const prompt = yield* Queue.take(fake.sent);
      expect(prompt.text).toContain("rm -rf build");
      const [approve, deny] = prompt.buttons?.[0] ?? [];
      expect(approve?.data).toMatch(/^ok:[0-9a-f]{32}$/);
      expect(deny?.data).toBe(`no:${approve?.data.slice(3)}`);

      yield* Queue.offer(fake.inbox, [press("ok:request-1"), press("ok:")]);
      expect(yield* Queue.take(fake.acks)).toBe("This request is no longer open.");
      expect(yield* Queue.take(fake.acks)).toBe("This request is no longer open.");
      // The stranger's press of the real button is refused before it is read.
      yield* Queue.offer(fake.inbox, [press(approve!.data, STRANGER)]);
      yield* Queue.offer(fake.inbox, [press(approve!.data), press(deny!.data)]);
      expect(yield* Queue.take(fake.acks)).toBe("Approved from Telegram.");
      expect(yield* Queue.take(fake.acks)).toBe("Already answered.");
      expect(yield* Queue.takeAll(fake.responses)).toEqual([
        { requestId: "request-1", decision: "accept" },
      ]);
      expect(fake.state.edits.at(-1)).toMatch(/rm -rf build[\s\S]*Approved from Telegram\.$/);
    }),
  ),
);

it.effect("silence denies: an unanswered prompt is declined once its window passes", () =>
  run((fake) =>
    Effect.gen(function* () {
      yield* connectAndBind(fake);
      yield* seedApproval("request-2", "git push --force");
      const prompt = yield* Queue.take(fake.sent);
      expect(prompt.text).toContain("No answer within 5 minutes denies it.");

      yield* TestClock.adjust("6 minutes");
      // Expiry runs after each poll; an empty batch is a poll that found nothing.
      yield* Queue.offer(fake.inbox, []);
      expect(yield* Queue.take(fake.responses)).toEqual({
        requestId: "request-2",
        decision: "decline",
      });
      yield* Queue.offer(fake.inbox, [press(prompt.buttons![0]![0]!.data)]);
      expect(yield* Queue.take(fake.acks)).toBe("This request is no longer open.");
      expect(yield* Queue.size(fake.responses)).toBe(0);
      expect(yield* auditKinds).toContain("messaging.approval_expired");
    }),
  ),
);

it.effect("disabling stops polling at once, enabling resumes, deleting drops the token", () =>
  run((fake) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      const secrets = yield* ServerSecretStore;
      const channelId = yield* connectAndBind(fake);
      yield* Queue.offer(fake.inbox, [text(OWNER, "/help")]);
      yield* Queue.take(fake.sent);
      const polls = fake.state.receives;

      yield* notifications.setChannelEnabled({ channelId, enabled: false });
      yield* Queue.offer(fake.inbox, [text(OWNER, "while off")]);
      yield* TestClock.adjust("1 hour");
      expect(fake.state.receives).toBe(polls);
      expect(yield* Queue.size(fake.inbox)).toBe(1);

      yield* notifications.setChannelEnabled({ channelId, enabled: true });
      expect((yield* Queue.take(fake.sent)).text).toBe('Sent to "Fix the build".');

      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<{ readonly secret_ref: string }>`SELECT secret_ref
          FROM notification_channels WHERE channel_id = ${channelId}`;
      expect(row?.secret_ref).toMatch(/^messaging-telegram-/);
      expect(Option.isSome(yield* secrets.get(row!.secret_ref))).toBe(true);
      yield* notifications.removeChannel(channelId);
      expect(Option.isNone(yield* secrets.get(row!.secret_ref))).toBe(true);
      expect(yield* sql`SELECT chat_id FROM messaging_chats`).toEqual([]);
    }),
  ),
);

it.effect("refuses an empty allowlist, a malformed sender id and a malformed token", () =>
  run(() =>
    Effect.gen(function* () {
      const service = yield* MessagingService;
      const reasons: Array<MessagingError["reason"]> = [];
      for (const input of [
        { allowedUserIds: [" ", ""], token: TOKEN },
        { allowedUserIds: ["@owner"], token: TOKEN },
        { allowedUserIds: [OWNER], token: "not-a-token" },
      ]) {
        const error = yield* service
          .connect({ kind: "telegram", name: "Phone", ...input })
          .pipe(Effect.flip);
        reasons.push(error.reason);
      }
      expect(reasons).toEqual(["empty_allowlist", "invalid_sender_id", "invalid_token"]);
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT channel_id FROM notification_channels`).toEqual([]);
    }),
  ),
);
