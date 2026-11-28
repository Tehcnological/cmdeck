import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { AuthOrchestrationReadScope, EnvironmentAuthorizationError } from "../auth.ts";
import { HeartbeatError, HeartbeatStatus } from "./monitoring.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  heartbeatStatus: "cmdeck.heartbeat.status",
} as const;

export const rpcs = [
  Rpc.make(methods.heartbeatStatus, {
    payload: Schema.Struct({}),
    success: HeartbeatStatus,
    error: Schema.Union([HeartbeatError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {
  [methods.heartbeatStatus]: AuthOrchestrationReadScope,
} as const;

export const scopes = {} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
