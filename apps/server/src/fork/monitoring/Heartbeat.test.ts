import { describe, expect, it } from "@effect/vitest";
import * as NodeNet from "node:net";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import type * as Notifications from "../notifications/Notifications.ts";
import * as Heartbeat from "./Heartbeat.ts";
import { layerHeartbeatTest } from "./monitoring.testkit.ts";

const withHeartbeat = <A, E>(
  heartbeat: Parameters<typeof layerHeartbeatTest>[0]["heartbeat"],
  body: (refs: {
    readonly httpStatus: Ref.Ref<number>;
    readonly alerts: Ref.Ref<ReadonlyArray<Notifications.AlertInput>>;
  }) => Effect.Effect<A, E, Heartbeat.Heartbeat | EventSink.EventSinkV2>,
) =>
  Effect.gen(function* () {
    const httpStatus = yield* Ref.make(503);
    const requests = yield* Ref.make<ReadonlyArray<string>>([]);
    const alerts = yield* Ref.make<ReadonlyArray<Notifications.AlertInput>>([]);
    return yield* body({ httpStatus, alerts }).pipe(
      Effect.provide(layerHeartbeatTest({ heartbeat, httpStatus, requests, alerts })),
    );
  });

const titles = (alerts: Ref.Ref<ReadonlyArray<Notifications.AlertInput>>) =>
  Ref.get(alerts).pipe(Effect.map((all) => all.map((alert) => alert.title)));

describe("heartbeat", () => {
  it.effect("a failing probe alerts once while it stays down, and once when it answers again", () =>
    withHeartbeat(
      { enabled: true, probes: [{ name: "API", target: "https://status.example.com/health" }] },
      ({ httpStatus, alerts }) =>
        Effect.gen(function* () {
          const heartbeat = yield* Heartbeat.Heartbeat;
          for (let pass = 0; pass < 3; pass++) yield* heartbeat.check;
          expect(yield* titles(alerts)).toEqual(["Not responding: API"]);

          yield* Ref.set(httpStatus, 200);
          yield* heartbeat.check;
          yield* heartbeat.check;
          expect(yield* titles(alerts)).toEqual(["Not responding: API", "Responding again: API"]);
          expect((yield* heartbeat.status).checks).toMatchObject([{ label: "API", up: true }]);
        }),
    ),
  );

  it.effect("a running turn silent past the stall time alerts once; its end is the recovery", () =>
    withHeartbeat({ enabled: true, sessionStallMinutes: 15 }, ({ alerts }) =>
      Effect.gen(function* () {
        const sink = yield* EventSink.EventSinkV2;
        const heartbeat = yield* Heartbeat.Heartbeat;
        const at = (minutes: number) => DateTime.makeUnsafe(minutes * 60_000);
        const threadId = ThreadId.make("thread:ci");
        const runId = RunId.make("run:ci");
        const nodeId = NodeId.make("node:ci");
        const instanceId = ProviderInstanceId.make("codex");
        const modelSelection = { instanceId, model: "gpt-5" };
        const run = {
          id: runId,
          threadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make("message:ci"),
          rootNodeId: nodeId,
          activeAttemptId: null,
          status: "running" as const,
          requestedAt: at(0),
          startedAt: at(0),
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        };
        const providerActivity = (minutes: number) =>
          sink.write({
            events: [
              {
                id: EventId.make(`node:ci:${minutes}`),
                type: "node.updated",
                threadId,
                runId,
                occurredAt: at(minutes),
                payload: {
                  id: nodeId,
                  threadId,
                  runId,
                  parentNodeId: null,
                  rootNodeId: nodeId,
                  kind: "root_turn",
                  status: "running",
                  countsForRun: true,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  runtimeRequestId: null,
                  checkpointScopeId: null,
                  startedAt: at(0),
                  completedAt: null,
                },
              },
            ],
          });
        yield* sink.write({
          events: [
            {
              id: EventId.make("thread:ci"),
              type: "thread.created",
              threadId,
              occurredAt: at(0),
              payload: {
                id: threadId,
                projectId: ProjectId.make("project:test"),
                title: "Fix CI",
                createdBy: "user",
                creationSource: "web",
                providerInstanceId: instanceId,
                modelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                activeProviderThreadId: null,
                lineage: {
                  rootThreadId: threadId,
                  parentThreadId: null,
                  relationshipToParent: null,
                },
                forkedFrom: null,
                createdAt: at(0),
                updatedAt: at(0),
                archivedAt: null,
                deletedAt: null,
                settledOverride: null,
                settledAt: null,
                snoozedUntil: null,
                snoozedAt: null,
                lastVisitedAt: null,
              },
            },
            {
              id: EventId.make("run:ci"),
              type: "run.created",
              threadId,
              occurredAt: at(0),
              payload: run,
            },
          ],
        });

        // The provider keeps talking: no alert even though the turn started 20 minutes ago.
        yield* TestClock.adjust("10 minutes");
        yield* providerActivity(10);
        yield* TestClock.adjust("10 minutes");
        yield* heartbeat.check;
        expect(yield* titles(alerts)).toEqual([]);

        yield* TestClock.adjust("6 minutes");
        yield* heartbeat.check;
        yield* heartbeat.check;
        expect(yield* titles(alerts)).toEqual(["Not responding: Turn in “Fix CI”"]);

        yield* sink.write({
          events: [
            {
              id: EventId.make("run:ci:done"),
              type: "run.updated",
              threadId,
              occurredAt: at(26),
              payload: { ...run, status: "completed", completedAt: at(26) },
            },
          ],
        });
        yield* heartbeat.check;
        expect(yield* titles(alerts)).toEqual([
          "Not responding: Turn in “Fix CI”",
          "Responding again: Turn in “Fix CI”",
        ]);
      }),
    ),
  );

  it.effect("turned off, a pass checks nothing", () =>
    withHeartbeat({ enabled: false, probes: [{ name: "API", target: "db.internal:5432" }] }, () =>
      Effect.gen(function* () {
        expect(yield* (yield* Heartbeat.Heartbeat).check).toEqual({ enabled: false, checks: [] });
      }),
    ),
  );

  it.live("a TCP probe answers when the port accepts, and explains when it does not", () =>
    Effect.gen(function* () {
      const server = NodeNet.createServer((socket) => socket.destroy());
      yield* Effect.promise(
        () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
      );
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      expect(yield* Heartbeat.tcpProbe("127.0.0.1", port)).toBeNull();
      yield* Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())));
      expect(yield* Heartbeat.tcpProbe("127.0.0.1", port)).toMatch(/^Connection failed/);
    }),
  );
});
