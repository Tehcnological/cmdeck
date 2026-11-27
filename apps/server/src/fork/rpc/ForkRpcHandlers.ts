import {
  AuditLogError,
  CMDECK_RPC_VERSION,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  NotificationChannelError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as AuditLog from "../audit/AuditLog.ts";
import * as Notifications from "../notifications/Notifications.ts";

/** Spread into the server's WS handlers; each fork module adds its methods here. */
export const make = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const audit = yield* Effect.serviceOption(AuditLog.AuditLog);
  const unavailable = Effect.fail(new AuditLogError({}));
  const notifications = yield* Effect.serviceOption(Notifications.Notifications);
  const noNotifications = Effect.fail(new NotificationChannelError({}));
  return ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
    [CMDECK_WS_METHODS.auditList]: (input) =>
      Option.isSome(audit) ? audit.value.list(input) : unavailable,
    [CMDECK_WS_METHODS.auditVerify]: () =>
      Option.isSome(audit) ? audit.value.verify : unavailable,
    [CMDECK_WS_METHODS.notificationChannelsList]: () =>
      Option.isSome(notifications) ? notifications.value.listChannels : noNotifications,
    [CMDECK_WS_METHODS.notificationChannelsSetEnabled]: (input) =>
      Option.isSome(notifications) ? notifications.value.setChannelEnabled(input) : noNotifications,
    [CMDECK_WS_METHODS.notificationChannelsRemove]: (input) =>
      Option.isSome(notifications)
        ? notifications.value.removeChannel(input.channelId)
        : noNotifications,
    [CMDECK_WS_METHODS.notificationsSubscribeAlerts]: () =>
      Option.isSome(notifications)
        ? Stream.unwrap(notifications.value.subscribeAlerts)
        : Stream.empty,
  });
});
