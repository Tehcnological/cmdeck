import { describe, expect, it } from "@effect/vitest";
import * as NodeNet from "node:net";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import type * as Notifications from "../notifications/Notifications.ts";
import * as Heartbeat from "./Heartbeat.ts";
import { layerHeartbeatTest } from "./monitoring.testkit.ts";

const withHeartbeat = <A, E>(
  heartbeat: Parameters<typeof layerHeartbeatTest>[0]["heartbeat"],
  body: (refs: {
    readonly httpStatus: Ref.Ref<number>;
    readonly alerts: Ref.Ref<ReadonlyArray<Notifications.AlertInput>>;
  }) => Effect.Effect<A, E, Heartbeat.Heartbeat | SqlClient.SqlClient>,
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
        const sql = yield* SqlClient.SqlClient;
        const heartbeat = yield* Heartbeat.Heartbeat;
        const start = "1970-01-01T00:00:00.000Z";
        yield* sql`INSERT INTO orchestration_v2_projection_threads
          (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
            created_at, updated_at, payload_json)
          VALUES ('thread:ci', 'project:test', 'Fix CI', 'codex', 'full-access', 'default',
            ${start}, ${start}, '{}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_runs
          (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
          VALUES ('run:ci', 'thread:ci', 1, 'codex', 'running', ${start}, '{}')`;
        yield* sql`INSERT INTO orchestration_v2_events
          (event_id, thread_id, run_id, event_type, occurred_at, payload_json)
          VALUES ('event:1', 'thread:ci', 'run:ci', 'run.started', ${start}, '{}')`;

        yield* TestClock.adjust("10 minutes");
        yield* heartbeat.check;
        expect(yield* titles(alerts)).toEqual([]);

        yield* TestClock.adjust("10 minutes");
        yield* heartbeat.check;
        yield* heartbeat.check;
        expect(yield* titles(alerts)).toEqual(["Not responding: Turn in “Fix CI”"]);

        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed'`;
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
