import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AuthAccessReadScope,
  AuthDiagnosticsReadScope,
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
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "../audit/AuditLog.ts";
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

it.effect("serves the audit log only to clients with access scope", () =>
  Effect.gen(function* () {
    const group = ForkWsRpcGroup.middleware(RpcScopeAuthorization);
    // Built once for the test's scope; each client below would otherwise close its own database.
    const audit = yield* Layer.build(
      AuditLog.layerService.pipe(Layer.provide(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer))),
    );
    const handlers = group
      .toLayer(ForkRpcHandlers.make)
      .pipe(Layer.provide(Layer.succeedContext(audit)));
    const client = (scopes: Parameters<typeof RpcAuthorization.layer>[0]) =>
      RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, RpcAuthorization.layer(scopes))),
      );

    const owner = yield* client([AuthAccessReadScope]);
    expect(yield* owner[CMDECK_WS_METHODS.auditList]({})).toEqual({ entries: [], hasMore: false });
    expect(yield* owner[CMDECK_WS_METHODS.auditVerify]({})).toMatchObject({ ok: true });

    const diagnosticsOnly = yield* client([AuthDiagnosticsReadScope, AuthOrchestrationReadScope]);
    const refused = {
      _tag: "EnvironmentAuthorizationError",
      requiredPermission: AuthAccessReadScope,
    };
    expect(yield* diagnosticsOnly[CMDECK_WS_METHODS.auditList]({}).pipe(Effect.flip)).toMatchObject(
      refused,
    );
    expect(
      yield* diagnosticsOnly[CMDECK_WS_METHODS.auditVerify]({}).pipe(Effect.flip),
    ).toMatchObject(refused);
  }).pipe(Effect.scoped),
);
