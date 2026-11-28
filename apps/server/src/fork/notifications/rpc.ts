import {
  CMDECK_WS_METHODS,
  type ForkRpcModuleHandlers,
  NotificationChannelError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Notifications from "./Notifications.ts";

export const handlers = Effect.gen(function* () {
  const notifications = yield* Effect.serviceOption(Notifications.Notifications);
  const noNotifications = Effect.fail(new NotificationChannelError({}));
  return {
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
  } satisfies ForkRpcModuleHandlers<"notifications">;
});
