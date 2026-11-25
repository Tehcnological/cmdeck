import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { buildPairingUrl } from "../startupAccess.ts";
import * as ServerE2eeIdentity from "./ServerE2eeIdentity.ts";

const identity = (publicKeyBase64Url: string) =>
  Layer.succeed(ServerE2eeIdentity.ServerE2eeIdentity, {
    getKeypair: Effect.die("unused"),
    getDescriptor: Effect.succeed({ publicKeyBase64Url, fingerprint: "unused" }),
    rotate: Effect.die("unused"),
  });

it.effect("running-server pairing links carry the key only while E2EE is on", () =>
  Effect.gen(function* () {
    const keyFor = (e2eeMode: "off" | "prefer" | "require") =>
      ServerE2eeIdentity.pairingServerIdentityKey.pipe(
        Effect.provide(Layer.merge(identity("server-key"), ServerSettings.layerTest({ e2eeMode }))),
      );
    assert.isUndefined(yield* keyFor("off"));
    assert.equal(yield* keyFor("prefer"), "server-key");
    assert.equal(yield* keyFor("require"), "server-key");
    // Narrow runtimes without the services print links without a key.
    assert.isUndefined(yield* ServerE2eeIdentity.pairingServerIdentityKey);
  }),
);

it.effect("CLI pairing reads the mode from disk and the key from the secret store", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    assert.isUndefined(yield* ServerE2eeIdentity.readPairingServerIdentityKey);
    yield* fs.writeFileString(config.settingsPath, JSON.stringify({ e2eeMode: "prefer" }));
    const key = yield* ServerE2eeIdentity.readPairingServerIdentityKey;
    assert.isString(key);
    // Stable across reads: the CLI and the server share one identity.
    assert.equal(yield* ServerE2eeIdentity.readPairingServerIdentityKey, key);

    const pairingUrl = buildPairingUrl("http://100.72.10.4:3783", "pairing-token", {
      serverIdentityKey: key,
    });
    assert.deepEqual(resolveRemotePairingTarget({ pairingUrl }), {
      credential: "pairing-token",
      httpBaseUrl: "http://100.72.10.4:3783/",
      wsBaseUrl: "ws://100.72.10.4:3783/",
      serverIdentityKey: key!,
    });
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-e2ee-identity-test-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
