// Fork-only. One delivery path for milestones and fork alerts to configured channels (WI-1.04).
import {
  type ForkAlert,
  type MilestoneEvent,
  type MilestoneEventType,
  MilestoneId,
  type NotificationChannel,
  NotificationChannelError,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as AuditLog from "../audit/AuditLog.ts";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_PER_HOUR = 30;
const FIRST_RETRY_MS = 30_000;
const MAX_ATTEMPTS = 8;
const SEND_TIMEOUT = "30 seconds";
const BATCH = 50;
const KEPT_MS = 30 * 24 * HOUR_MS;
const ALERT_KIND = "alert";

/** Milestones worth a message; starts, resumes and resolutions are not news on their own. */
const NOTIFIED_TYPES: ReadonlyArray<MilestoneEventType> = [
  "thread.run_settled",
  "thread.needs_input",
  "thread.guest_request",
  "pr.watch_wake",
  "workflow.needs_input",
  "workflow.run_paused",
  "workflow.run_ended",
];

/** A channel module's failure. `reason` is a short category; it is stored and shown, redacted. */
export class NotificationDeliveryError extends Schema.TaggedError<NotificationDeliveryError>()(
  "NotificationDeliveryError",
  { reason: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {
  override get message(): string {
    return `Notification delivery failed: ${this.reason}.`;
  }
}

export const NotificationChannelRules = Schema.Struct({
  /** Absent means every project; an alert without a project always passes. */
  projectIds: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Milestone types and `alert`; absent means all of them. */
  kinds: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Minutes after local midnight on the server; may wrap past midnight. Messages are dropped. */
  quietHours: Schema.optionalKey(
    Schema.Struct({ startMinute: Schema.Number, endMinute: Schema.Number }),
  ),
});
export type NotificationChannelRules = typeof NotificationChannelRules.Type;

export interface NotificationMessage {
  /** The milestone id or alert id; a channel gets each one once. */
  readonly dedupeId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly projectId: string | null;
  readonly threadId: string | null;
}

export interface NotificationChannelTarget {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly config: unknown;
  /** The name of a stored secret the module resolves when it sends. Never the secret itself. */
  readonly secretRef: string | null;
}

/** What a channel module (Telegram, Slack, Web Push) implements. */
export interface NotificationChannelDriver {
  readonly kind: string;
  readonly send: (
    channel: NotificationChannelTarget,
    message: NotificationMessage,
  ) => Effect.Effect<void, NotificationDeliveryError>;
}

/**
 * Whether a milestone must not notify anyone. Quiet turns (WI-2.12) and incognito or temporary
 * threads (WI-1.07) provide this when they land; until then nothing is suppressed.
 */
export class NotificationSuppression extends Context.Reference<{
  readonly suppress: (event: MilestoneEvent) => Effect.Effect<boolean>;
}>("t3/fork/notifications/NotificationSuppression", {
  defaultValue: () => ({ suppress: () => Effect.succeed(false) }),
}) {}

export interface AddChannelInput {
  readonly kind: string;
  readonly name: string;
  readonly config?: unknown;
  readonly secretRef?: string | null | undefined;
  readonly rules?: NotificationChannelRules | undefined;
  readonly rateLimitPerHour?: number | undefined;
  readonly enabled?: boolean | undefined;
}

export interface AlertInput {
  /** Repeating an id sends it once; absent makes a new one. */
  readonly id?: string | undefined;
  readonly title: string;
  readonly body: string;
  readonly projectId?: string | undefined;
  readonly threadId?: string | undefined;
}

export class Notifications extends Context.Service<
  Notifications,
  {
    /** Tells the open app and every enabled channel that wants alerts. Never fails the caller. */
    readonly alert: (input: AlertInput) => Effect.Effect<void>;
    /** Alerts raised from now on, for the open app; subscribed when this runs. */
    readonly subscribeAlerts: Effect.Effect<Stream.Stream<ForkAlert>, never, Scope.Scope>;
    readonly addChannel: (
      input: AddChannelInput,
    ) => Effect.Effect<string, NotificationChannelError>;
    readonly listChannels: Effect.Effect<
      ReadonlyArray<NotificationChannel>,
      NotificationChannelError
    >;
    readonly setChannelEnabled: (input: {
      readonly channelId: string;
      readonly enabled: boolean;
    }) => Effect.Effect<void, NotificationChannelError>;
    readonly removeChannel: (channelId: string) => Effect.Effect<void, NotificationChannelError>;
  }
>()("t3/fork/notifications/Notifications") {}

interface ChannelRow {
  readonly channel_id: string;
  readonly kind: string;
  readonly name: string;
  readonly enabled: number;
  readonly rules_json: string;
  readonly created_at: number;
  readonly last_error: string | null;
}

interface DueRow {
  readonly channel_id: string;
  readonly dedupe_id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly project_id: string | null;
  readonly thread_id: string | null;
  readonly attempts: number;
  readonly channel_kind: string;
  readonly name: string;
  readonly config_json: string;
  readonly secret_ref: string | null;
  readonly rate_limit_per_hour: number;
}

const isChannelError = Schema.is(NotificationChannelError);
const RulesJson = Schema.fromJsonString(NotificationChannelRules);
const decodeRules = Schema.decodeUnknownOption(RulesJson);
const encodeRules = Schema.encodeSync(RulesJson);
const ConfigJson = Schema.fromJsonString(Schema.Unknown);
const decodeConfig = Schema.decodeUnknownOption(ConfigJson);
const encodeConfig = Schema.encodeSync(ConfigJson);

// Quiet hours follow the server's own clock and zone.
const minuteOfDay = (now: number) => {
  const parts = DateTime.toParts(
    DateTime.makeZonedUnsafe(now, { timeZone: DateTime.zoneMakeLocal() }),
  );
  return parts.hour * 60 + parts.minute;
};

const inQuietHours = (rules: NotificationChannelRules, minute: number) => {
  const quiet = rules.quietHours;
  if (quiet === undefined || quiet.startMinute === quiet.endMinute) return false;
  return quiet.startMinute < quiet.endMinute
    ? minute >= quiet.startMinute && minute < quiet.endMinute
    : minute >= quiet.startMinute || minute < quiet.endMinute;
};

const wants = (rules: NotificationChannelRules, message: NotificationMessage, minute: number) =>
  (rules.kinds === undefined || rules.kinds.includes(message.kind)) &&
  (rules.projectIds === undefined ||
    (message.projectId === null
      ? message.kind === ALERT_KIND
      : rules.projectIds.includes(message.projectId))) &&
  !inQuietHours(rules, minute);

const retryDelayMs = (attempts: number) =>
  Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), HOUR_MS);

/** Server-authored English, like other fork alerts; the thread title says which one. */
const describe = (event: MilestoneEvent, threadTitle: string | null) => {
  const thread = threadTitle ?? "A thread";
  switch (event.type) {
    case "thread.run_settled":
      return { title: `Run ${event.outcome}`, body: thread };
    case "thread.needs_input":
      return { title: event.kind === "approval" ? "Needs approval" : "Needs input", body: thread };
    case "thread.guest_request":
      return { title: "Guest request", body: thread };
    case "pr.watch_wake":
      return { title: "Pull request update", body: event.summary || thread };
    case "workflow.needs_input":
      return { title: "Workflow needs input", body: `${event.runTitle}: ${event.question}` };
    case "workflow.run_paused":
      return { title: "Workflow paused", body: `${event.runTitle}: ${event.reason}` };
    case "workflow.run_ended":
      return {
        title: `Workflow ${event.outcome}`,
        body: event.detail === null ? event.runTitle : `${event.runTitle}: ${event.detail}`,
      };
    default:
      return undefined;
  }
};

const make = Effect.fn("Notifications.make")(function* (
  drivers: ReadonlyArray<NotificationChannelDriver>,
) {
  const sql = yield* SqlClient.SqlClient;
  const hub = yield* MilestoneHub.MilestoneHub;
  const random = yield* SecureRandom.SecureRandom;
  const byKind = new Map(drivers.map((driver) => [driver.kind, driver]));
  const inApp = yield* PubSub.sliding<ForkAlert>(64);
  // Opened by every enqueue; the delivery loop closes it before each pass.
  const wake = yield* Latch.make(false);
  // Holds the subscription and delivery fibre, only while a channel is enabled.
  const active = yield* FiberHandle.make<void, never>();
  const transitions = yield* Semaphore.make(1);
  const toError = (cause: unknown) => new NotificationChannelError({ cause });

  // Upstream's projection is read only; a missing thread just gets a generic line.
  const threadTitle = (threadId: string) =>
    sql<{ readonly title: string }>`SELECT title FROM orchestration_v2_projection_threads
        WHERE thread_id = ${threadId}`.pipe(
      Effect.map((rows) => rows[0]?.title ?? null),
      Effect.orElseSucceed(() => null),
    );

  const enqueue = Effect.fn("Notifications.enqueue")(function* (message: NotificationMessage) {
    const channels = yield* sql<{
      readonly channel_id: string;
      readonly rules_json: string;
    }>`SELECT channel_id, rules_json FROM notification_channels WHERE enabled = 1`;
    const now = yield* Clock.currentTimeMillis;
    const minute = minuteOfDay(now);
    for (const channel of channels) {
      const rules = Option.getOrElse(decodeRules(channel.rules_json), () => ({}));
      if (!wants(rules, message, minute)) continue;
      yield* sql`INSERT OR IGNORE INTO notification_outbox ${sql.insert({
        channel_id: channel.channel_id,
        dedupe_id: message.dedupeId,
        kind: message.kind,
        title: message.title,
        body: message.body,
        project_id: message.projectId,
        thread_id: message.threadId,
        created_at: now,
        attempts: 0,
        next_attempt_at: now,
      })}`;
    }
    yield* wake.open;
  });

  const enqueueMilestone = Effect.fn("Notifications.enqueueMilestone")(
    function* (event: MilestoneEvent) {
      if (yield* (yield* NotificationSuppression).suppress(event)) return;
      const text = describe(
        event,
        event.threadId === null ? null : yield* threadTitle(event.threadId),
      );
      if (text === undefined) return;
      yield* enqueue({
        dedupeId: event.id,
        kind: event.type,
        title: redactSecrets(text.title),
        body: redactSecrets(text.body),
        projectId: event.projectId,
        threadId: event.threadId,
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not queue a notification", { milestoneId: event.id, cause }),
        ),
      ),
  );

  // Approvals asked before a restart publish no milestone; the outbox key keeps repeats out.
  const reconcilePendingRequests = Effect.fn("Notifications.reconcilePendingRequests")(
    function* () {
      const rows = yield* sql<{
        readonly request_id: string;
        readonly request_kind: string;
        readonly created_at: string;
        readonly thread_id: string;
        readonly project_id: string;
        readonly relationship: string | null;
        readonly parent_thread_id: string | null;
      }>`SELECT r.runtime_request_id AS request_id, r.kind AS request_kind, r.created_at,
            t.thread_id, t.project_id,
            json_extract(t.payload_json, '$.lineage.relationshipToParent') AS relationship,
            json_extract(t.payload_json, '$.lineage.parentThreadId') AS parent_thread_id
          FROM orchestration_v2_projection_runtime_requests r
          JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
          WHERE r.status = 'pending' AND t.deleted_at IS NULL AND t.archived_at IS NULL
            AND r.kind IN ('command', 'file-read', 'file-change', 'permission', 'user_input',
              'mcp-elicitation')`;
      for (const row of rows) {
        if (row.relationship === "subagent") continue;
        yield* enqueueMilestone({
          id: MilestoneId.make(`thread.needs_input:${row.request_id}`),
          occurredAt: row.created_at,
          projectId: ProjectId.make(row.project_id),
          threadId: ThreadId.make(row.thread_id),
          parentThreadId:
            row.parent_thread_id === null ? null : ThreadId.make(row.parent_thread_id),
          actor: { type: "agent" },
          isSubagentChild: false,
          type: "thread.needs_input",
          requestId: RuntimeRequestId.make(row.request_id),
          kind:
            row.request_kind === "user_input" || row.request_kind === "mcp-elicitation"
              ? "user_input"
              : "approval",
        });
      }
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not reconcile pending approvals", { cause }),
    ),
  );

  const recordFailure = Effect.fn("Notifications.recordFailure")(function* (
    row: DueRow,
    now: number,
    reason: string,
  ) {
    const attempts = row.attempts + 1;
    const gaveUp = attempts >= MAX_ATTEMPTS;
    const error = redactSecrets(reason);
    yield* sql`UPDATE notification_outbox SET attempts = ${attempts}, last_error = ${error},
          next_attempt_at = ${now + retryDelayMs(attempts)}, failed_at = ${gaveUp ? now : null}
        WHERE channel_id = ${row.channel_id} AND dedupe_id = ${row.dedupe_id}`;
    yield* AuditLog.note({
      kind: "notification.delivery_failed",
      actor: "system",
      subject: row.channel_id,
      detail: { messageId: row.dedupe_id, attempt: attempts, error, gaveUp },
    });
  });

  const deliver = Effect.fn("Notifications.deliver")(function* (row: DueRow, now: number) {
    const [sent] = yield* sql<{
      readonly n: number;
      readonly oldest: number | null;
    }>`SELECT COUNT(*) AS n, MIN(delivered_at) AS oldest FROM notification_outbox
        WHERE channel_id = ${row.channel_id} AND delivered_at > ${now - HOUR_MS}`;
    if (sent !== undefined && sent.n >= row.rate_limit_per_hour && sent.oldest !== null) {
      yield* sql`UPDATE notification_outbox SET next_attempt_at = ${sent.oldest + HOUR_MS}
          WHERE channel_id = ${row.channel_id} AND dedupe_id = ${row.dedupe_id}`;
      return;
    }
    const driver = byKind.get(row.channel_kind);
    const send =
      driver === undefined
        ? Effect.fail(new NotificationDeliveryError({ reason: "channel module not available" }))
        : driver.send(
            {
              id: row.channel_id,
              kind: row.channel_kind,
              name: row.name,
              config: Option.getOrNull(decodeConfig(row.config_json)),
              secretRef: row.secret_ref,
            },
            {
              dedupeId: row.dedupe_id,
              kind: row.kind,
              title: row.title,
              body: row.body,
              projectId: row.project_id,
              threadId: row.thread_id,
            },
          );
    const failure = yield* send.pipe(
      Effect.timeout(SEND_TIMEOUT),
      Effect.as<string | null>(null),
      Effect.catchTags({
        NotificationDeliveryError: (error) => Effect.succeed(error.reason),
        TimeoutError: () => Effect.succeed("timed out"),
      }),
      Effect.catchDefect(() => Effect.succeed("channel module crashed")),
    );
    if (failure !== null) return yield* recordFailure(row, now, failure);
    yield* sql`UPDATE notification_outbox SET delivered_at = ${now}, attempts = ${row.attempts + 1}
        WHERE channel_id = ${row.channel_id} AND dedupe_id = ${row.dedupe_id}`;
  });

  /** Sends what is due and returns when the next pending message is. */
  const deliverDue = Effect.fn("Notifications.deliverDue")(function* () {
    const now = yield* Clock.currentTimeMillis;
    const due = yield* sql<DueRow>`SELECT o.channel_id, o.dedupe_id, o.kind, o.title, o.body,
          o.project_id, o.thread_id, o.attempts, c.kind AS channel_kind, c.name, c.config_json,
          c.secret_ref, c.rate_limit_per_hour
        FROM notification_outbox o JOIN notification_channels c ON c.channel_id = o.channel_id
        WHERE c.enabled = 1 AND o.delivered_at IS NULL AND o.failed_at IS NULL
          AND o.next_attempt_at <= ${now}
        ORDER BY o.created_at, o.dedupe_id LIMIT ${BATCH}`;
    for (const row of due) yield* deliver(row, now);
    const [next] = yield* sql<{ readonly at: number | null }>`SELECT MIN(o.next_attempt_at) AS at
        FROM notification_outbox o JOIN notification_channels c ON c.channel_id = o.channel_id
        WHERE c.enabled = 1 AND o.delivered_at IS NULL AND o.failed_at IS NULL`;
    return next?.at ?? null;
  });

  const deliveryLoop = Effect.gen(function* () {
    for (;;) {
      yield* wake.close;
      const next = yield* deliverDue().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Notification delivery pass failed", { cause }).pipe(Effect.as(null)),
        ),
      );
      if (next === null) {
        yield* wake.await;
      } else {
        const wait = Math.max(0, next - (yield* Clock.currentTimeMillis));
        yield* wake.await.pipe(Effect.timeoutOrElse({ duration: wait, orElse: () => Effect.void }));
      }
    }
  });

  const worker = Effect.gen(function* () {
    // Subscribed before the first await, so a milestone published right after enabling counts.
    const milestones = yield* hub.subscribe({ types: NOTIFIED_TYPES });
    yield* milestones.pipe(Stream.runForEach(enqueueMilestone), Effect.forkScoped);
    const cutoff = (yield* Clock.currentTimeMillis) - KEPT_MS;
    // shortcut: pruned only when the worker starts (boot or first enable); add a timer if outboxes grow.
    yield* sql`DELETE FROM notification_outbox
        WHERE COALESCE(delivered_at, failed_at) < ${cutoff}`.pipe(Effect.ignore);
    yield* reconcilePendingRequests();
    return yield* deliveryLoop;
  }).pipe(Effect.scoped);

  /** Starts the worker for the first enabled channel and stops it with the last. */
  const sync = Effect.gen(function* () {
    const [row] = yield* sql<{
      readonly n: number;
    }>`SELECT COUNT(*) AS n FROM notification_channels WHERE enabled = 1`;
    if ((row?.n ?? 0) > 0) yield* FiberHandle.run(active, worker, { onlyIfMissing: true });
    else yield* FiberHandle.clear(active);
  }).pipe(transitions.withPermits(1));

  const alert: Notifications["Service"]["alert"] = Effect.fn("Notifications.alert")(
    function* (input) {
      const forkAlert: ForkAlert = {
        id: input.id ?? (yield* random.uuidV4()),
        occurredAt: yield* Clock.currentTimeMillis,
        title: redactSecrets(input.title),
        body: redactSecrets(input.body),
      };
      yield* PubSub.publish(inApp, forkAlert);
      yield* enqueue({
        dedupeId: `alert:${forkAlert.id}`,
        kind: ALERT_KIND,
        title: forkAlert.title,
        body: forkAlert.body,
        projectId: input.projectId ?? null,
        threadId: input.threadId ?? null,
      });
    },
    Effect.catchCause((cause) => Effect.logWarning("Could not queue an alert", { cause })),
  );

  const addChannel: Notifications["Service"]["addChannel"] = Effect.fn("Notifications.addChannel")(
    function* (input) {
      if (!byKind.has(input.kind)) {
        return yield* new NotificationChannelError({});
      }
      const id = yield* random.uuidV4();
      yield* sql`INSERT INTO notification_channels ${sql.insert({
        channel_id: id,
        kind: input.kind,
        name: input.name,
        enabled: input.enabled === false ? 0 : 1,
        config_json: encodeConfig(input.config ?? {}),
        secret_ref: input.secretRef ?? null,
        rules_json: encodeRules(input.rules ?? {}),
        rate_limit_per_hour: Math.max(
          1,
          Math.trunc(input.rateLimitPerHour ?? DEFAULT_RATE_LIMIT_PER_HOUR),
        ),
        created_at: yield* Clock.currentTimeMillis,
      })}`;
      yield* AuditLog.note({
        kind: "notification.channel_added",
        subject: id,
        detail: { channelKind: input.kind, name: input.name },
      });
      yield* sync;
      return id;
    },
    Effect.mapError((cause) => (isChannelError(cause) ? cause : toError(cause))),
  );

  const listChannels: Notifications["Service"]["listChannels"] = sql<ChannelRow>`
      SELECT c.channel_id, c.kind, c.name, c.enabled, c.rules_json, c.created_at,
        (SELECT o.last_error FROM notification_outbox o
          WHERE o.channel_id = c.channel_id AND o.delivered_at IS NULL AND o.last_error IS NOT NULL
          ORDER BY o.created_at DESC LIMIT 1) AS last_error
      FROM notification_channels c ORDER BY c.created_at, c.channel_id`.pipe(
    Effect.map((rows) =>
      rows.map((row): NotificationChannel => ({
        id: row.channel_id,
        kind: row.kind,
        name: row.name,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        lastError: row.last_error,
      })),
    ),
    Effect.mapError(toError),
    Effect.withSpan("Notifications.listChannels"),
  );

  const setChannelEnabled: Notifications["Service"]["setChannelEnabled"] = Effect.fn(
    "Notifications.setChannelEnabled",
  )(function* (input) {
    yield* sql`UPDATE notification_channels SET enabled = ${input.enabled ? 1 : 0}
        WHERE channel_id = ${input.channelId}`;
    yield* sync;
    yield* wake.open;
  }, Effect.mapError(toError));

  const removeChannel: Notifications["Service"]["removeChannel"] = Effect.fn(
    "Notifications.removeChannel",
  )(function* (channelId) {
    const removed = yield* sql<{ readonly kind: string }>`DELETE FROM notification_channels
        WHERE channel_id = ${channelId} RETURNING kind`;
    if (removed.length === 0) return;
    yield* sql`DELETE FROM notification_outbox WHERE channel_id = ${channelId}`;
    yield* AuditLog.note({
      kind: "notification.channel_removed",
      subject: channelId,
      detail: { channelKind: removed[0]!.kind },
    });
    yield* sync;
  }, Effect.mapError(toError));

  yield* sync.pipe(
    Effect.catchCause((cause) => Effect.logWarning("Could not start notifications", { cause })),
  );

  return Notifications.of({
    alert,
    subscribeAlerts: PubSub.subscribe(inApp).pipe(Effect.map(Stream.fromSubscription)),
    addChannel,
    listChannels,
    setChannelEnabled,
    removeChannel,
  });
});

/** With these channel modules; messaging and Web Push modules pass theirs (WI-3.01, 3.02, 3.11). */
export const layerWithDrivers = (drivers: ReadonlyArray<NotificationChannelDriver>) =>
  Layer.effect(Notifications, make(drivers));

/** No channel module ships yet, so the server adds no channel until one does. */
export const layer = layerWithDrivers([]);
