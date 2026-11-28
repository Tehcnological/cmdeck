import { expect, it } from "@effect/vitest";
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";

import * as Notifications from "../notifications/Notifications.ts";
import * as UsageAlerts from "./UsageAlerts.ts";
import { claudeAtPercent as claude, layerUsageAlertsTest } from "./usageAlerts.testkit.ts";

const withAlerts = <A, E, R>(
  options: { readonly usedPercent: number; readonly usageAlertPercents?: ReadonlyArray<number> },
  body: (fake: {
    readonly providers: Ref.Ref<ReadonlyArray<ServerProvider>>;
    readonly sent: Queue.Queue<Notifications.NotificationMessage>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const providers = yield* Ref.make<ReadonlyArray<ServerProvider>>([claude(options.usedPercent)]);
    const sent = yield* Queue.unbounded<Notifications.NotificationMessage>();
    const driver: Notifications.NotificationChannelDriver = {
      kind: "fake",
      send: (_channel, message) => Queue.offer(sent, message).pipe(Effect.asVoid),
    };
    return yield* body({ providers, sent }).pipe(
      Effect.provide(
        layerUsageAlertsTest({
          providers,
          drivers: [driver],
          ...(options.usageAlertPercents === undefined
            ? {}
            : { usageAlertPercents: options.usageAlertPercents }),
        }),
      ),
    );
  });

it.effect("alerts a window past the default 80% once, and again after it drops and recrosses", () =>
  withAlerts({ usedPercent: 85 }, ({ providers, sent }) =>
    Effect.gen(function* () {
      const alerts = yield* UsageAlerts.UsageAlerts;
      const notifications = yield* Notifications.Notifications;
      yield* notifications.addChannel({ kind: "fake", name: "Phone" });

      expect(yield* alerts.check).toBe(1);
      expect(yield* Queue.take(sent)).toMatchObject({
        kind: "alert",
        title: "Claude: Weekly limit at 85%",
        body: "You have used 85% of the Weekly limit, past your 80% alert.",
      });
      // State is read from the database on every check, as after a restart.
      expect(yield* alerts.check).toBe(0);
      yield* Ref.set(providers, [claude(95)]);
      expect(yield* alerts.check).toBe(0);

      yield* Ref.set(providers, [claude(2)]);
      expect(yield* alerts.check).toBe(0);
      yield* Ref.set(providers, [claude(81)]);
      expect(yield* alerts.check).toBe(1);
      expect((yield* Queue.take(sent)).title).toBe("Claude: Weekly limit at 81%");
    }),
  ),
);

it.effect("an empty threshold list turns alerts off", () =>
  withAlerts({ usedPercent: 99, usageAlertPercents: [] }, () =>
    Effect.gen(function* () {
      const alerts = yield* UsageAlerts.UsageAlerts;
      yield* (yield* Notifications.Notifications).addChannel({ kind: "fake", name: "Phone" });
      expect(yield* alerts.check).toBe(0);
    }),
  ),
);
