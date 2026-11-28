import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  ForkAlert,
  NotificationChannel,
  NotificationChannelError,
  NotificationChannelIdInput,
  NotificationChannelSetEnabledInput,
} from "./notifications.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  notificationChannelsList: "cmdeck.notifications.channels.list",
  notificationChannelsSetEnabled: "cmdeck.notifications.channels.setEnabled",
  notificationChannelsRemove: "cmdeck.notifications.channels.remove",
  notificationsSubscribeAlerts: "cmdeck.notifications.subscribeAlerts",
} as const;

const NotificationChannelsError = Schema.Union([
  NotificationChannelError,
  EnvironmentAuthorizationError,
]);

export const rpcs = [
  Rpc.make(methods.notificationChannelsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(NotificationChannel),
    error: NotificationChannelsError,
  }),
  Rpc.make(methods.notificationChannelsSetEnabled, {
    payload: NotificationChannelSetEnabledInput,
    error: NotificationChannelsError,
  }),
  Rpc.make(methods.notificationChannelsRemove, {
    payload: NotificationChannelIdInput,
    error: NotificationChannelsError,
  }),
  Rpc.make(methods.notificationsSubscribeAlerts, {
    payload: Schema.Struct({}),
    success: ForkAlert,
    error: EnvironmentAuthorizationError,
    stream: true,
  }),
] as const;

export const readScopes = {
  [methods.notificationChannelsList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  [methods.notificationChannelsSetEnabled]: AuthSettingsWriteScope,
  [methods.notificationChannelsRemove]: AuthSettingsWriteScope,
  [methods.notificationsSubscribeAlerts]: AuthOrchestrationReadScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
