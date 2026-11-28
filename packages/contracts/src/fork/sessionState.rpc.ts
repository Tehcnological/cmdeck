import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import type { ForkRpcScopes } from "./rpc.ts";
import { SessionStateCard, SessionStateError, SessionStateThreadInput } from "./sessionState.ts";

export const methods = {
  sessionStateGet: "cmdeck.sessionState.get",
  sessionStateClear: "cmdeck.sessionState.clear",
} as const;

const SessionStateFailure = Schema.Union([SessionStateError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.sessionStateGet, {
    payload: SessionStateThreadInput,
    success: Schema.NullOr(SessionStateCard),
    error: SessionStateFailure,
  }),
  Rpc.make(methods.sessionStateClear, {
    payload: SessionStateThreadInput,
    error: SessionStateFailure,
  }),
] as const;

export const readScopes = {
  [methods.sessionStateGet]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Clearing changes what the thread's next automated turns are told, like other thread changes.
  [methods.sessionStateClear]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
