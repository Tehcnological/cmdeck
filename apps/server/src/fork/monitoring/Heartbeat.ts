// Fork-only. Heartbeat health monitoring (WI-2.12, decision A6): a deterministic pass, no model,
// that running turns still hear from their provider, linked environments answer and the user's
// probes answer. Each check alerts once when it stops answering and once when it answers again.
import {
  type HeartbeatCheck,
  type HeartbeatProbe,
  type HeartbeatStatus,
  parseHeartbeatProbeTarget,
} from "@t3tools/contracts";
import * as NodeNet from "node:net";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";

import * as PeerLinks from "../../peer/PeerLinks.ts";
import * as Settings from "../../serverSettings.ts";
import * as Notifications from "../notifications/Notifications.ts";
import { heartbeatTransitions, type Observation } from "./heartbeatLogic.ts";

const INTERVAL = Duration.minutes(1);
const PROBE_TIMEOUT = Duration.seconds(10);

export class Heartbeat extends Context.Service<
  Heartbeat,
  {
    /** One pass now; with the heartbeat off it checks nothing and contacts no one. */
    readonly check: Effect.Effect<HeartbeatStatus>;
    /** What the last pass found, without checking again. */
    readonly status: Effect.Effect<HeartbeatStatus>;
  }
>()("t3/fork/monitoring/Heartbeat") {}

interface CheckRow {
  readonly check_key: string;
  readonly kind: HeartbeatCheck["kind"];
  readonly label: string;
  readonly up: number;
  readonly since: number;
  readonly checked_at: number;
  readonly detail: string | null;
}

const toCheck = (row: CheckRow): HeartbeatCheck => ({
  key: row.check_key,
  kind: row.kind,
  label: row.label,
  up: row.up === 1,
  since: row.since,
  checkedAt: row.checked_at,
  detail: row.detail,
});

/** Null when the TCP port accepts a connection within the time box, else why not. */
export const tcpProbe = (host: string, port: number): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    const socket = NodeNet.createConnection({ host, port });
    const done = (result: string | null) => {
      socket.destroy();
      resume(Effect.succeed(result));
    };
    socket.setTimeout(Duration.toMillis(PROBE_TIMEOUT), () => done("No answer in 10 seconds."));
    socket.once("connect", () => done(null));
    socket.once("error", (error) => done(`Connection failed: ${error.message}`));
    return Effect.sync(() => socket.destroy());
  });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* Settings.ServerSettingsService;
  const notifications = yield* Notifications.Notifications;
  const client = yield* HttpClient.HttpClient;
  const peerLinks = yield* Effect.serviceOption(PeerLinks.PeerLinks);
  const lock = yield* Semaphore.make(1);

  const readChecks = sql<CheckRow>`SELECT * FROM heartbeat_checks ORDER BY kind, label`.pipe(
    Effect.map((rows) => rows.map(toCheck)),
  );

  /** Running turns whose provider has been silent past the stall time. */
  const sessionChecks = Effect.fn("Heartbeat.sessionChecks")(function* (
    stallMinutes: number,
    now: number,
  ) {
    // shortcut: scans runs by status (no status-only index); fine at a pass a minute, index it if slow.
    // A running run's events are the newest in its thread, so the backward stream walk stops early.
    const runs = yield* sql<{
      readonly run_id: string;
      readonly title: string;
      readonly requested_at: string;
      readonly last_event_at: string | null;
    }>`SELECT r.run_id, t.title, r.requested_at,
        (SELECT e.occurred_at FROM orchestration_events e
          WHERE e.aggregate_kind = 'thread' AND e.stream_id = r.thread_id
            AND json_extract(e.metadata_json, '$.runId') = r.run_id
          ORDER BY e.sequence DESC LIMIT 1) AS last_event_at
      FROM orchestration_v2_projection_runs r
      JOIN orchestration_v2_projection_threads t ON t.thread_id = r.thread_id
      WHERE r.status IN ('starting', 'running') AND t.deleted_at IS NULL`;
    const stallMs = stallMinutes * 60_000;
    return runs.map((run): Observation => {
      const last = Date.parse(run.last_event_at ?? run.requested_at);
      const silentMinutes = Math.floor((now - last) / 60_000);
      const up = !(now - last >= stallMs);
      return {
        key: `session:${run.run_id}`,
        kind: "session",
        label: `Turn in “${run.title}”`,
        up,
        detail: up ? null : `No event from the provider for ${silentMinutes} minutes.`,
      };
    });
  });

  const environmentChecks = Option.match(peerLinks, {
    onNone: () => Effect.succeed<ReadonlyArray<Observation>>([]),
    onSome: Effect.fn("Heartbeat.environmentChecks")(
      function* (links: PeerLinks.PeerLinks["Service"]) {
        if (!(yield* links.enabled)) return [];
        return (yield* links.list).flatMap((link): ReadonlyArray<Observation> =>
          link.status === "expired"
            ? []
            : [
                {
                  key: `environment:${link.environmentId}`,
                  kind: "environment",
                  label: link.label,
                  up: link.status === "reachable",
                  detail:
                    link.status === "reachable" ? null : "The linked environment is unreachable.",
                },
              ],
        );
      },
      Effect.orElseSucceed((): ReadonlyArray<Observation> => []),
    ),
  });

  const probeCheck = (probe: HeartbeatProbe): Effect.Effect<Observation> => {
    const target = parseHeartbeatProbeTarget(probe.target);
    const failure: Effect.Effect<string | null> =
      typeof target === "string"
        ? Effect.succeed(target)
        : target.kind === "tcp"
          ? tcpProbe(target.host, target.port)
          : client.get(target.url).pipe(
              Effect.map((response) =>
                response.status < 400 ? null : `Answered HTTP ${response.status}.`,
              ),
              Effect.timeoutOption(PROBE_TIMEOUT),
              Effect.map(Option.getOrElse(() => "No answer in 10 seconds.")),
              Effect.catchCause(() => Effect.succeed("The request failed.")),
            );
    return failure.pipe(
      Effect.map((detail): Observation => ({
        key: `probe:${probe.name}:${probe.target}`,
        kind: "probe",
        label: probe.name,
        up: detail === null,
        detail,
      })),
    );
  };

  const check: Heartbeat["Service"]["check"] = Effect.gen(function* () {
    const config = (yield* settings.getSettings).cmdeck.heartbeat;
    if (!config.enabled) return { enabled: false, checks: [] };
    const now = yield* Clock.currentTimeMillis;
    const observed = [
      ...(yield* sessionChecks(config.sessionStallMinutes, now)),
      ...(config.environments ? yield* environmentChecks : []),
      ...(yield* Effect.forEach(config.probes, probeCheck, { concurrency: 4 })),
    ];
    const { rows, removed, alerts } = heartbeatTransitions(yield* readChecks, observed, now);
    // Stored before telling, so a failed send is not repeated on every pass.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const row of rows) {
          yield* sql`INSERT INTO heartbeat_checks ${sql.insert({
            check_key: row.key,
            kind: row.kind,
            label: row.label,
            up: row.up ? 1 : 0,
            since: row.since,
            checked_at: row.checkedAt,
            detail: row.detail,
          })} ON CONFLICT (check_key) DO UPDATE SET label = excluded.label, up = excluded.up,
            since = excluded.since, checked_at = excluded.checked_at, detail = excluded.detail`;
        }
        if (removed.length > 0) {
          yield* sql`DELETE FROM heartbeat_checks WHERE ${sql.in("check_key", removed)}`;
        }
      }),
    );
    for (const alert of alerts) yield* notifications.alert(alert);
    return { enabled: true, checks: rows };
  }).pipe(
    lock.withPermits(1),
    Effect.catchCause((cause) =>
      Effect.logWarning("Heartbeat pass failed", { cause }).pipe(
        Effect.andThen(readChecks),
        Effect.map((checks) => ({ enabled: true, checks })),
        Effect.orElseSucceed(() => ({ enabled: true, checks: [] })),
      ),
    ),
    Effect.withSpan("Heartbeat.check"),
  );

  const status: Heartbeat["Service"]["status"] = Effect.gen(function* () {
    const enabled = (yield* settings.getSettings).cmdeck.heartbeat.enabled;
    return { enabled, checks: enabled ? yield* readChecks : [] };
  }).pipe(Effect.orElseSucceed(() => ({ enabled: false, checks: [] })));

  // Off means no timer: the pass loop runs only while the setting is on.
  const active = yield* FiberHandle.make();
  const sync = (enabled: boolean) =>
    enabled
      ? FiberHandle.run(active, Effect.repeat(check, Schedule.spaced(INTERVAL)), {
          onlyIfMissing: true,
        })
      : FiberHandle.clear(active).pipe(
          Effect.andThen(sql`DELETE FROM heartbeat_checks`.pipe(Effect.ignore)),
        );
  const changes = yield* settings.subscribeChanges;
  const initial = yield* settings.getSettings.pipe(
    Effect.map((value) => value.cmdeck.heartbeat.enabled),
    Effect.orElseSucceed(() => false),
  );
  yield* Stream.concat(
    Stream.make(initial),
    changes.pipe(Stream.map((value) => value.cmdeck.heartbeat.enabled)),
  ).pipe(Stream.changes, Stream.runForEach(sync), Effect.forkScoped);

  return Heartbeat.of({ check, status });
});

export const layer = Layer.effect(Heartbeat, make);
