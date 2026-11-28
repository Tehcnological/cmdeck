import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  RpcScopeAuthorization,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";
import * as ForkRpcHandlers from "../rpc/ForkRpcHandlers.ts";
import { layerMemoryTest, threads } from "./memory.testkit.ts";

const clientWith = Effect.fn("clientWith")(function* (
  scopes: Parameters<typeof RpcAuthorization.layer>[0],
) {
  const group = ForkWsRpcGroup.middleware(RpcScopeAuthorization);
  const context = yield* Effect.context<never>();
  return yield* RpcTest.makeClient(group).pipe(
    Effect.provide(
      Layer.merge(
        group.toLayer(ForkRpcHandlers.make).pipe(Layer.provide(Layer.succeedContext(context))),
        RpcAuthorization.layer(scopes),
      ),
    ),
  );
});

describe("memory RPCs", () => {
  it.layer(layerMemoryTest({ memoryEnabled: true }))((it) => {
    it.effect("/remember saves the person's own item; editing needs settings write", () =>
      Effect.gen(function* () {
        const operator = yield* clientWith([
          AuthOrchestrationReadScope,
          AuthOrchestrationOperateScope,
        ]);
        const item = yield* operator[CMDECK_WS_METHODS.memoryRemember]({
          threadId: threads.main.id,
          content: "Use pnpm, not npm",
          kind: "rule",
        });
        expect(item).toMatchObject({
          scope: "project:project-app",
          status: "active",
          provenance: "user_explicit",
        });
        expect(
          (yield* operator[CMDECK_WS_METHODS.memoryList]({ status: "active" })).map(({ id }) => id),
        ).toContain(item.id);

        const refused = yield* operator[CMDECK_WS_METHODS.memoryApplyEdit]({
          items: [item],
          operation: { type: "retire" },
        }).pipe(Effect.flip);
        expect(refused).toMatchObject({
          _tag: "EnvironmentAuthorizationError",
          requiredPermission: AuthSettingsWriteScope,
        });

        const editor = yield* clientWith([AuthSettingsWriteScope]);
        const { changes } = yield* editor[CMDECK_WS_METHODS.memoryApplyEdit]({
          items: [item],
          operation: { type: "retire" },
        });
        expect(changes.map(({ after }) => after.status)).toEqual(["retired"]);
      }).pipe(Effect.scoped),
    );

    it.effect("an incognito thread's /remember is refused until it is promoted", () =>
      Effect.gen(function* () {
        const client = yield* clientWith([
          AuthOrchestrationReadScope,
          AuthOrchestrationOperateScope,
        ]);
        yield* client[CMDECK_WS_METHODS.memorySetThreadMode]({
          threadId: threads.worktree.id,
          mode: "incognito",
        });
        const remember = client[CMDECK_WS_METHODS.memoryRemember]({
          threadId: threads.worktree.id,
          content: "Saved after promotion",
        });
        expect(yield* remember.pipe(Effect.flip)).toMatchObject({
          _tag: "MemoryRpcError",
          reason: "This thread's memory is incognito, so nothing it learns is saved.",
        });

        yield* client[CMDECK_WS_METHODS.memorySetThreadMode]({
          threadId: threads.worktree.id,
          mode: "persistent",
        });
        expect(yield* remember).toMatchObject({ status: "active" });
        expect(
          yield* client[CMDECK_WS_METHODS.memoryThreadMode]({ threadId: threads.worktree.id }),
        ).toEqual({ mode: "persistent" });
      }).pipe(Effect.scoped),
    );
  });

  it.layer(layerMemoryTest({ memoryEnabled: false }))((it) => {
    it.effect("refuses every method while memory is off", () =>
      Effect.gen(function* () {
        const client = yield* clientWith([AuthOrchestrationReadScope]);
        expect(yield* client[CMDECK_WS_METHODS.memoryList]({}).pipe(Effect.flip)).toMatchObject({
          _tag: "MemoryRpcError",
          reason: "Memory is off. Turn it on in Settings > Memory.",
        });
      }).pipe(Effect.scoped),
    );
  });
});
