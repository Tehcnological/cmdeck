import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  AuthAccessReadScope,
  AuthDiagnosticsReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  AuthTerminalReadScope,
  CMDECK_RPC_VERSION,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  MessageId,
  type OrchestrationV2ConversationMessage,
  RpcScopeAuthorization,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";
import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as MessagePins from "../messagePins/MessagePins.ts";
import * as Notifications from "../notifications/Notifications.ts";
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

it.effect("lets readers list notification channels and only settings writers change them", () =>
  Effect.gen(function* () {
    const group = ForkWsRpcGroup.middleware(RpcScopeAuthorization);
    const services = yield* Layer.build(
      Notifications.layerWithDrivers([{ kind: "test", send: () => Effect.void }]).pipe(
        Layer.provideMerge(MilestoneHub.layer),
        Layer.provideMerge(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer)),
      ),
    );
    const channelId = yield* Notifications.Notifications.pipe(
      Effect.flatMap((notifications) => notifications.addChannel({ kind: "test", name: "Test" })),
      Effect.provide(services),
    );
    const handlers = group
      .toLayer(ForkRpcHandlers.make)
      .pipe(Layer.provide(Layer.succeedContext(services)));
    const client = (scopes: Parameters<typeof RpcAuthorization.layer>[0]) =>
      RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, RpcAuthorization.layer(scopes))),
      );

    const reader = yield* client([AuthOrchestrationReadScope]);
    expect(yield* reader[CMDECK_WS_METHODS.notificationChannelsList]({})).toMatchObject([
      { id: channelId, name: "Test", enabled: true, lastError: null },
    ]);
    expect(
      yield* reader[CMDECK_WS_METHODS.notificationChannelsRemove]({ channelId }).pipe(Effect.flip),
    ).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredPermission: AuthSettingsWriteScope,
    });

    const writer = yield* client([AuthOrchestrationReadScope, AuthSettingsWriteScope]);
    yield* writer[CMDECK_WS_METHODS.notificationChannelsSetEnabled]({ channelId, enabled: false });
    expect(yield* writer[CMDECK_WS_METHODS.notificationChannelsList]({})).toMatchObject([
      { id: channelId, enabled: false },
    ]);
    yield* writer[CMDECK_WS_METHODS.notificationChannelsRemove]({ channelId });
    expect(yield* writer[CMDECK_WS_METHODS.notificationChannelsList]({})).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("lets readers see a thread's pins and only operators pin or unpin", () =>
  Effect.gen(function* () {
    const group = ForkWsRpcGroup.middleware(RpcScopeAuthorization);
    const threadId = ThreadId.make("thread-pinned");
    const messageId = MessageId.make("message-pinned");
    const projection = Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getMessagesById: () =>
        Effect.succeed(
          new Map([
            [
              messageId,
              {
                id: messageId,
                threadId,
                role: "assistant",
                text: "The plan",
                streaming: false,
              } as OrchestrationV2ConversationMessage,
            ],
          ]),
        ),
    });
    const services = yield* Layer.build(
      MessagePins.layer.pipe(Layer.provide(Layer.merge(Sqlite.layerMemory, projection))),
    );
    const handlers = group
      .toLayer(ForkRpcHandlers.make)
      .pipe(Layer.provide(Layer.succeedContext(services)));
    const client = (scopes: Parameters<typeof RpcAuthorization.layer>[0]) =>
      RpcTest.makeClient(group).pipe(
        Effect.provide(Layer.merge(handlers, RpcAuthorization.layer(scopes))),
      );
    const operator = yield* client([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
    yield* operator[CMDECK_WS_METHODS.messagePinsPin]({ threadId, messageId });

    // Another client on the same server reads the pin back.
    const reader = yield* client([AuthOrchestrationReadScope]);
    expect(yield* reader[CMDECK_WS_METHODS.messagePinsList]({ threadId })).toMatchObject([
      { threadId, messageId, role: "assistant", preview: "The plan" },
    ]);
    expect(
      yield* reader[CMDECK_WS_METHODS.messagePinsUnpin]({ threadId, messageId }).pipe(Effect.flip),
    ).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredPermission: AuthOrchestrationOperateScope,
    });

    yield* operator[CMDECK_WS_METHODS.messagePinsUnpin]({ threadId, messageId });
    expect(yield* reader[CMDECK_WS_METHODS.messagePinsList]({ threadId })).toEqual([]);
  }).pipe(Effect.scoped),
);
