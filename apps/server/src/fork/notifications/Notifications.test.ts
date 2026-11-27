import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { type MilestoneEvent, MilestoneId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as Notifications from "./Notifications.ts";

// Built from parts so no literal token sits in the source.
const fakeToken = ["gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");

interface Sent {
  readonly channelId: string;
  readonly message: Notifications.NotificationMessage;
}

/** A channel that reports each attempt and fails while `failing` is set. */
const fakeChannel = Effect.gen(function* () {
  const sent = yield* Queue.unbounded<Sent>();
  const failing = yield* Ref.make(false);
  const driver: Notifications.NotificationChannelDriver = {
    kind: "fake",
    send: (channel, message) =>
      Queue.offer(sent, { channelId: channel.id, message }).pipe(
        Effect.andThen(Ref.get(failing)),
        Effect.flatMap((fail) =>
          fail
            ? Effect.fail(
                new Notifications.NotificationDeliveryError({
                  reason: `rejected token ${fakeToken}`,
                }),
              )
            : Effect.void,
        ),
      ),
  };
  return { sent, failing, driver };
});

const run = <A, E>(
  body: (
    fake: Effect.Success<typeof fakeChannel>,
  ) => Effect.Effect<
    A,
    E,
    | Notifications.Notifications
    | MilestoneHub.MilestoneHub
    | AuditLog.AuditLog
    | SqlClient.SqlClient
  >,
) =>
  Effect.gen(function* () {
    const fake = yield* fakeChannel;
    return yield* body(fake).pipe(
      Effect.provide(
        Notifications.layerWithDrivers([fake.driver]).pipe(
          Layer.provideMerge(MilestoneHub.layer),
          Layer.provideMerge(AuditLog.layerService),
          // The in-memory database runs every migration, so ForkSchema creates the tables.
          Layer.provideMerge(Sqlite.layerMemory),
          Layer.provideMerge(NodeCrypto.layer),
        ),
      ),
    );
  });

const runSettled = (id: string): MilestoneEvent => ({
  id: MilestoneId.make(`thread.run_settled:${id}`),
  occurredAt: "2026-11-27T00:00:00.000Z",
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
  parentThreadId: null,
  actor: { type: "agent" },
  isSubagentChild: false,
  type: "thread.run_settled",
  runId: RunId.make(id),
  outcome: "completed",
});

it.effect("a milestone published twice is one outbox row per channel", () =>
  run(({ sent }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      const hub = yield* MilestoneHub.MilestoneHub;
      const sql = yield* SqlClient.SqlClient;
      const first = yield* notifications.addChannel({ kind: "fake", name: "One" });
      const second = yield* notifications.addChannel({ kind: "fake", name: "Two" });

      const event = runSettled("run-1");
      yield* hub.publish(event);
      yield* hub.publish(event);
      const deliveries = [yield* Queue.take(sent), yield* Queue.take(sent)];
      expect(deliveries.map((delivery) => delivery.channelId).toSorted()).toEqual(
        [first, second].toSorted(),
      );
      expect(deliveries[0]?.message).toMatchObject({
        dedupeId: event.id,
        kind: "thread.run_settled",
        title: "Run completed",
      });

      // Below the hub's own dedupe: an alert repeated by id is also one row per channel.
      yield* notifications.alert({ id: "same", title: "Check", body: "once" });
      yield* notifications.alert({ id: "same", title: "Check", body: "once" });
      const rows = yield* sql<{ readonly dedupe_id: string; readonly n: number }>`
        SELECT dedupe_id, COUNT(*) AS n FROM notification_outbox GROUP BY dedupe_id
        ORDER BY dedupe_id`;
      expect(rows).toEqual([
        { dedupe_id: "alert:same", n: 2 },
        { dedupe_id: event.id, n: 2 },
      ]);
    }),
  ),
);

it.effect("drops milestones the suppression seam marks quiet", () =>
  run(({ sent }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      const hub = yield* MilestoneHub.MilestoneHub;
      const sql = yield* SqlClient.SqlClient;
      yield* notifications.addChannel({ kind: "fake", name: "Phone" });
      yield* hub.publish(runSettled("quiet"));
      yield* hub.publish(runSettled("loud"));
      // Milestones are handled in order, so the quiet one was already dropped.
      expect((yield* Queue.take(sent)).message.dedupeId).toBe("thread.run_settled:loud");
      const [rows] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM notification_outbox`;
      expect(rows?.n).toBe(1);
    }),
  ).pipe(
    Effect.provideService(Notifications.NotificationSuppression, {
      suppress: (event) => Effect.succeed(event.id === "thread.run_settled:quiet"),
    }),
  ),
);

it.effect("a failing channel retries with backoff and records each failure", () =>
  run(({ sent, failing }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      const audit = yield* AuditLog.AuditLog;
      yield* Ref.set(failing, true);
      const channelId = yield* notifications.addChannel({ kind: "fake", name: "Flaky" });
      yield* notifications.alert({ id: "a1", title: "Disk", body: "almost full" });

      yield* Queue.take(sent);
      // Retries are due 30 s after the first failure, then 60 s after the second.
      yield* TestClock.adjust("29 seconds");
      expect(yield* Queue.size(sent)).toBe(0);
      yield* TestClock.adjust("1 second");
      yield* Queue.take(sent);
      expect((yield* notifications.listChannels)[0]).toMatchObject({
        id: channelId,
        lastError: "rejected token [redacted]",
      });

      yield* Ref.set(failing, false);
      yield* TestClock.adjust("59 seconds");
      expect(yield* Queue.size(sent)).toBe(0);
      yield* TestClock.adjust("1 second");
      yield* Queue.take(sent);

      const failures = (yield* audit.list({})).entries.filter(
        (entry) => entry.kind === "notification.delivery_failed",
      );
      expect(failures.map((entry) => entry.detail)).toEqual([
        { messageId: "alert:a1", attempt: 2, error: "rejected token [redacted]", gaveUp: false },
        { messageId: "alert:a1", attempt: 1, error: "rejected token [redacted]", gaveUp: false },
      ]);
    }),
  ),
);

it.effect("redacts bodies before they reach a channel or the open app", () =>
  run(({ sent }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      yield* notifications.addChannel({ kind: "fake", name: "Phone" });
      const inApp = yield* Effect.scoped(
        Effect.gen(function* () {
          const next = yield* Stream.toPull(yield* notifications.subscribeAlerts);
          yield* notifications.alert({ title: "Leak", body: `token ${fakeToken} in output` });
          return yield* next;
        }),
      );
      expect(inApp[0]?.body).toBe("token [redacted] in output");
      expect((yield* Queue.take(sent)).message.body).toBe("token [redacted] in output");
    }),
  ),
);

it.effect("tells a channel about approvals already waiting when it starts", () =>
  run(({ sent }) =>
    Effect.gen(function* () {
      const notifications = yield* Notifications.Notifications;
      const sql = yield* SqlClient.SqlClient;
      const thread = (id: string, payload: object) =>
        sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
          thread_id: id,
          project_id: "project-1",
          title: `Title of ${id}`,
          default_provider: "codex",
          runtime_mode: "full-access",
          interaction_mode: "default",
          created_at: "2026-11-27T00:00:00.000Z",
          updated_at: "2026-11-27T00:00:00.000Z",
          payload_json: JSON.stringify(payload),
        })}`;
      const request = (id: string, threadId: string, status: string) =>
        sql`INSERT INTO orchestration_v2_projection_runtime_requests ${sql.insert({
          runtime_request_id: id,
          thread_id: threadId,
          node_id: "node-1",
          kind: "command",
          status,
          created_at: "2026-11-27T00:00:00.000Z",
          payload_json: "{}",
        })}`;
      yield* thread("thread-main", { lineage: { relationshipToParent: null } });
      yield* thread("thread-sub", {
        lineage: { relationshipToParent: "subagent", parentThreadId: "thread-main" },
      });
      yield* request("waiting", "thread-main", "pending");
      yield* request("answered", "thread-main", "resolved");
      yield* request("sub-waiting", "thread-sub", "pending");

      yield* notifications.addChannel({ kind: "fake", name: "Phone" });
      expect((yield* Queue.take(sent)).message).toMatchObject({
        dedupeId: "thread.needs_input:waiting",
        title: "Needs approval",
        body: "Title of thread-main",
      });
      // Disabled and enabled again, the worker reconciles again but the outbox key holds.
      const [channel] = yield* notifications.listChannels;
      yield* notifications.setChannelEnabled({ channelId: channel!.id, enabled: false });
      yield* notifications.setChannelEnabled({ channelId: channel!.id, enabled: true });
      const [rows] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM notification_outbox`;
      expect(rows?.n).toBe(1);
    }),
  ),
);
