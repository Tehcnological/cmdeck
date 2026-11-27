import {
  AuthOrchestrationReadScope,
  AuthTerminalReadScope,
  CMDECK_RPC_VERSION,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  RpcScopeAuthorization,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";
import * as ForkRpcHandlers from "./ForkRpcHandlers.ts";

it.effect("serves fork methods behind the same scope middleware as upstream ones", () =>
  Effect.gen(function* () {
    const group = ForkWsRpcGroup.middleware(RpcScopeAuthorization);
    const handlers = group.toLayer(ForkRpcHandlers.make);
    const client = (scopes: Parameters<typeof RpcAuthorization.layer>[0]) =>
      RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, RpcAuthorization.layer(scopes))),
      );

    const reader = yield* client([AuthOrchestrationReadScope]);
    expect(yield* reader[CMDECK_WS_METHODS.status]({})).toEqual({ version: CMDECK_RPC_VERSION });

    const terminalOnly = yield* client([AuthTerminalReadScope]);
    expect(yield* terminalOnly[CMDECK_WS_METHODS.status]({}).pipe(Effect.flip)).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredPermission: AuthOrchestrationReadScope,
    });
  }).pipe(Effect.scoped),
);
