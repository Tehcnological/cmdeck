import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  MessagingChat,
  MessagingChatInput,
  MessagingConnectInput,
  MessagingError,
} from "./messaging.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  messagingConnect: "cmdeck.messaging.connect",
  messagingChatsList: "cmdeck.messaging.chats.list",
  messagingChatsUnbind: "cmdeck.messaging.chats.unbind",
} as const;

const MessagingRpcError = Schema.Union([MessagingError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.messagingConnect, {
    payload: MessagingConnectInput,
    success: Schema.Struct({ channelId: Schema.String }),
    error: MessagingRpcError,
  }),
  Rpc.make(methods.messagingChatsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(MessagingChat),
    error: MessagingRpcError,
  }),
  Rpc.make(methods.messagingChatsUnbind, {
    payload: MessagingChatInput,
    error: MessagingRpcError,
  }),
] as const;

export const readScopes = {
  [methods.messagingChatsList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  [methods.messagingConnect]: AuthSettingsWriteScope,
  [methods.messagingChatsUnbind]: AuthSettingsWriteScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
