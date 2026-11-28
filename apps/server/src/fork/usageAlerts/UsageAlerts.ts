// Fork-only. Usage threshold alerts: a limit window past a user threshold tells the notification
// channels once per window period. Budgets and turn stops wait for upstream's usage thresholds.
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as Settings from "../../serverSettings.ts";
import * as UsageLimitSources from "../../usage/UsageLimitSources.ts";
import * as Notifications from "../notifications/Notifications.ts";
import {
  decideUsageAlerts,
  usageReadings,
  type WindowState,
  windowStateKey,
} from "./usageAlertsLogic.ts";

/** Windows untouched this long belong to accounts that are gone. */
const KEPT_MS = 90 * 24 * 60 * 60 * 1000;

const ToldJson = Schema.fromJsonString(Schema.Array(Schema.Number));
const decodeTold = Schema.decodeUnknownOption(ToldJson);
const encodeTold = Schema.encodeSync(ToldJson);

export class UsageAlerts extends Context.Service<
  UsageAlerts,
  {
    /**
     * Compares the current limit readings with `cmdeck.usageAlertPercents` and alerts for each
     * newly crossed window. Returns how many alerts it raised; nothing runs without an enabled
     * notification channel. Runs on its own whenever a reading changes.
     */
    readonly check: Effect.Effect<number>;
  }
>()("t3/fork/usageAlerts/UsageAlerts") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const notifications = yield* Notifications.Notifications;
  const settings = yield* Settings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const sources = yield* UsageLimitSources.UsageLimitSources;
  // One evaluation at a time, so two readings that land together tell a crossing once.
  const lock = yield* Semaphore.make(1);

  const check = Effect.gen(function* () {
    const percents = (yield* settings.getSettings).cmdeck.usageAlertPercents;
    if (percents.length === 0) return 0;
    const channels = yield* notifications.listChannels;
    if (!channels.some((channel) => channel.enabled)) return 0;

    const now = yield* Clock.currentTimeMillis;
    const readings = usageReadings(yield* registry.getProviders, yield* sources.current);
    const rows = yield* sql<{
      readonly account_key: string;
      readonly window_id: string;
      readonly resets_at: string | null;
      readonly told_json: string;
    }>`SELECT account_key, window_id, resets_at, told_json FROM usage_alert_windows`;
    const stored = new Map<string, WindowState>(
      rows.map((row) => [
        windowStateKey(row.account_key, row.window_id),
        {
          resetsAt: row.resets_at,
          told: Option.getOrElse(decodeTold(row.told_json), () => []),
        },
      ]),
    );
    const { alerts, changed } = decideUsageAlerts({ readings, percents, stored, now });

    // Stored before telling, so a failed send is not repeated on every refresh.
    for (const { accountKey, windowId, state } of changed) {
      yield* sql`INSERT INTO usage_alert_windows ${sql.insert({
        account_key: accountKey,
        window_id: windowId,
        resets_at: state.resetsAt,
        told_json: encodeTold(state.told),
        updated_at: now,
      })} ON CONFLICT (account_key, window_id) DO UPDATE SET resets_at = excluded.resets_at,
          told_json = excluded.told_json, updated_at = excluded.updated_at`;
    }
    if (changed.length > 0) {
      yield* sql`DELETE FROM usage_alert_windows WHERE updated_at < ${now - KEPT_MS}`;
    }
    for (const alert of alerts) {
      yield* notifications.alert({ title: alert.title, body: alert.body });
    }
    return alerts.length;
  }).pipe(
    lock.withPermits(1),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not check usage alerts", { cause }).pipe(Effect.as(0)),
    ),
    Effect.withSpan("UsageAlerts.check"),
  );

  // Reads only what the provider and hub refreshes already fetched; it starts no request itself.
  yield* Stream.merge(registry.streamChanges, sources.streamChanges).pipe(
    Stream.runForEach(() => check),
    Effect.forkScoped,
  );

  return UsageAlerts.of({ check });
});

export const layer = Layer.effect(UsageAlerts, make);
