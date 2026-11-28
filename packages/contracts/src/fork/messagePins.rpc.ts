import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  MessagePin,
  MessagePinInput,
  MessagePinsError,
  MessagePinsListInput,
  MessageUnpinInput,
} from "./messagePins.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  messagePinsList: "cmdeck.messagePins.list",
  messagePinsPin: "cmdeck.messagePins.pin",
  messagePinsUnpin: "cmdeck.messagePins.unpin",
} as const;

const MessagePinsFailure = Schema.Union([MessagePinsError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.messagePinsList, {
    payload: MessagePinsListInput,
    success: Schema.Array(MessagePin),
    error: MessagePinsFailure,
  }),
  Rpc.make(methods.messagePinsPin, {
    payload: MessagePinInput,
    success: MessagePin,
    error: MessagePinsFailure,
  }),
  Rpc.make(methods.messagePinsUnpin, {
    payload: MessageUnpinInput,
    error: MessagePinsFailure,
  }),
] as const;

export const readScopes = {
  [methods.messagePinsList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // A pin marks a thread for everyone on the server, as other thread changes do.
  [methods.messagePinsPin]: AuthOrchestrationOperateScope,
  [methods.messagePinsUnpin]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
