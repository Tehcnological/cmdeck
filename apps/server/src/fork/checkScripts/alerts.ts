import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Notifications from "../notifications/Notifications.ts";
import { CheckScripts } from "./CheckScripts.ts";

/**
 * Sends check reports (failures, approvals waiting, report-only output) on as fork alerts. The
 * scheduler sits beneath the notification service, so reports cross over on this subscription.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const checks = yield* CheckScripts;
    const notifications = yield* Notifications.Notifications;
    const reports = yield* checks.subscribeReports;
    yield* reports.pipe(
      Stream.runForEach((report) => notifications.alert(report)),
      Effect.forkScoped,
    );
  }),
);
