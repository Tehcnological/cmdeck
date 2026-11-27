import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";

// The `cmdeck.` prefix keeps fork methods clear of upstream's names. Append new methods here.
export const CMDECK_WS_METHODS = {
  status: "cmdeck.status",
} as const;

/** Raised when a fork RPC changes incompatibly, so a client can tell which fork methods a server has. */
export const CMDECK_RPC_VERSION = 1;

const CmdeckStatusRpc = Rpc.make(CMDECK_WS_METHODS.status, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ version: Schema.Number }),
  error: EnvironmentAuthorizationError,
});

/** Merged into `WsRpcGroup`, so fork methods share its scope middleware. */
export const ForkWsRpcGroup = RpcGroup.make(CmdeckStatusRpc);

/** Spread into `CLIENT_GUARDED_RPC_SCOPES`; every fork method needs one. */
export const FORK_RPC_SCOPES = {
  [CMDECK_WS_METHODS.status]: AuthOrchestrationReadScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof ForkWsRpcGroup>["_tag"], AuthEnvironmentScope>;
