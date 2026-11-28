import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import * as Modules from "./rpcModules.ts";

/**
 * A module's client-guarded scopes: one for each of its methods that is not a read. Each fork module
 * owns a `<module>.rpc.ts` (listed in `rpcModules.ts`) exporting `methods`, `rpcs`, `readScopes` and
 * `scopes`; this file only merges them.
 */
export type ForkRpcScopes<
  Rpcs extends ReadonlyArray<Rpc.Any>,
  ReadScopes extends Partial<Record<Rpcs[number]["_tag"], AuthEnvironmentScope>>,
> = Record<Exclude<Rpcs[number]["_tag"], keyof ReadScopes>, AuthEnvironmentScope>;

/** The handlers a server module provides for one module's RPCs, keyed as in `rpcModules.ts`. */
export type ForkRpcModuleHandlers<Name extends keyof typeof Modules> = RpcGroup.HandlersFrom<
  (typeof Modules)[Name]["rpcs"][number]
>;

type Module = (typeof Modules)[keyof typeof Modules];
type Merged<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void
  ? I
  : never;
const modules: ReadonlyArray<Module> = Object.values(Modules);
const merged = <K extends "methods" | "readScopes" | "scopes">(key: K) =>
  Object.assign({}, ...modules.map((module) => module[key])) as Merged<Module[K]>;

// The `cmdeck.` prefix keeps fork methods clear of upstream's names.
export const CMDECK_WS_METHODS = { status: "cmdeck.status", ...merged("methods") } as const;

/** Fork stream methods the client runtime subscribes to like upstream's. */
export type CmdeckSubscriptionRpcTag = typeof CMDECK_WS_METHODS.notificationsSubscribeAlerts;

/** Raised when a fork RPC changes incompatibly, so a client can tell which fork methods a server has. */
export const CMDECK_RPC_VERSION = 1;

const CmdeckStatusRpc = Rpc.make(CMDECK_WS_METHODS.status, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ version: Schema.Number }),
  error: EnvironmentAuthorizationError,
});

/** Merged into `WsRpcGroup`, so fork methods share its scope middleware. */
export const ForkWsRpcGroup = RpcGroup.make(
  CmdeckStatusRpc,
  ...modules.flatMap((module): ReadonlyArray<Module["rpcs"][number]> => module.rpcs),
);

/**
 * Reads: only the server checks these (spread into `RPC_REQUIRED_SCOPES`), like upstream reads, so
 * clients read them with `request` from query atoms. A client-guarded method needs a command
 * boundary, so a guarded read made from a query atom is refused on the client.
 */
export const FORK_RPC_READ_SCOPES = {
  [CMDECK_WS_METHODS.status]: AuthOrchestrationReadScope,
  ...merged("readScopes"),
} as const;

type ForkRpcTag = RpcGroup.Rpcs<typeof ForkWsRpcGroup>["_tag"];

/** Spread into `CLIENT_GUARDED_RPC_SCOPES`; every fork method not in the read map needs one. */
export const FORK_RPC_SCOPES = merged("scopes") satisfies Record<
  Exclude<ForkRpcTag, keyof typeof FORK_RPC_READ_SCOPES>,
  AuthEnvironmentScope
>;
