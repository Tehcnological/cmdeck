import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as RemoteMcpTokens from "./RemoteMcpTokens.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const layerStorage = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-token-test-" })),
  Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);

const layerTokensWithEnv = (env: Record<string, string>) =>
  RemoteMcpTokens.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    Layer.provideMerge(layerStorage),
  );

const createTestToken = (label: string, byte: number) =>
  RemoteMcpTokens.create({ label, access: "read-only" }).pipe(
    Effect.provideService(
      SecureRandom.SecureRandom,
      SecureRandom.make((size) => new Uint8Array(size).fill(byte)),
    ),
  );

it.effect("keeps a concurrent creation and revocation from separate token stores", () =>
  Effect.gen(function* () {
    const old = yield* createTestToken("old", 1);
    const otherStore = yield* ServerSecretStore.make;
    const [added, revoked] = yield* Effect.all(
      [
        createTestToken("new", 2),
        RemoteMcpTokens.revoke(old.record.id).pipe(
          Effect.provideService(ServerSecretStore.ServerSecretStore, otherStore),
        ),
      ],
      { concurrency: "unbounded" },
    );
    expect(revoked).toBe(true);
    expect(yield* RemoteMcpTokens.list()).toEqual([added.record]);
  }).pipe(Effect.provide(layerStorage)),
);

it.effect("shares one token-list read across misses and picks up an external write", () =>
  Effect.gen(function* () {
    const store = yield* ServerSecretStore.ServerSecretStore;
    let reads = 0;
    const verifier = yield* RemoteMcpTokens.makeVerifier.pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, {
        ...store,
        get: (name) => {
          reads++;
          return store.get(name);
        },
      }),
    );
    for (const byte of ["A", "B", "C"]) {
      expect(yield* verifier.verify(`t3mcp_${byte.repeat(43)}`)).toBeUndefined();
    }
    expect(reads).toBe(1);

    const added = yield* createTestToken("new", 2);
    yield* TestClock.adjust("2 seconds");
    expect((yield* verifier.verify(added.token))?.id).toBe(added.record.id);
    expect(reads).toBe(2);
  }).pipe(Effect.provide(layerStorage)),
);

it.effect("creates, lists and revokes tokens for Settings without listing a secret", () =>
  Effect.gen(function* () {
    const tokens = yield* RemoteMcpTokens.RemoteMcpTokens;
    expect(yield* tokens.status).toEqual({ envOverride: null, tokens: [] });

    const created = yield* tokens.create({ label: "laptop", access: "auto" });
    expect(created.secret).toMatch(/^t3mcp_[A-Za-z0-9_-]{43}$/u);
    expect(created.token).toEqual({
      id: created.token.id,
      label: "laptop",
      access: "auto",
      createdAt: created.token.createdAt,
    });
    // The CLI reads the same store.
    expect((yield* RemoteMcpTokens.list()).map((token) => token.id)).toEqual([created.token.id]);

    expect((yield* tokens.status).tokens).toEqual([created.token]);

    expect(yield* tokens.revoke(created.token.id)).toEqual({ revoked: true });
    expect(yield* tokens.revoke(created.token.id)).toEqual({ revoked: false });
    expect((yield* tokens.status).tokens).toEqual([]);
  }).pipe(Effect.provide(layerTokensWithEnv({}))),
);

it.effect.each([
  { env: {}, envOverride: null },
  { env: { T3CODE_REMOTE_MCP: "true" }, envOverride: true },
  { env: { T3CODE_REMOTE_MCP: "0" }, envOverride: false },
  { env: { T3CODE_REMOTE_MCP: "sometimes" }, envOverride: false },
])("reports T3CODE_REMOTE_MCP=$env.T3CODE_REMOTE_MCP as an override", ({ env, envOverride }) =>
  Effect.gen(function* () {
    const tokens = yield* RemoteMcpTokens.RemoteMcpTokens;
    expect((yield* tokens.status).envOverride).toBe(envOverride);
    expect(RemoteMcpTokens.isEnabled(envOverride, true)).toBe(envOverride ?? true);
  }).pipe(Effect.provide(layerTokensWithEnv(env))),
);
