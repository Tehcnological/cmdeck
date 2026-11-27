// @effect-diagnostics nodeBuiltinImport:off -- Inspects the key files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopSecretsKey from "./DesktopSecretsKey.ts";

const fakeSafeStorage = (options: {
  readonly available?: boolean;
  readonly backend?: string;
  readonly decryptFails?: boolean;
}) =>
  ElectronSafeStorage.ElectronSafeStorage.of({
    isEncryptionAvailable: Effect.succeed(options.available ?? true),
    encryptString: (value) => Effect.succeed(new TextEncoder().encode(`wrapped:${value}`)),
    decryptString: (value) =>
      options.decryptFails
        ? Effect.fail(new ElectronSafeStorage.ElectronSafeStorageDecryptError({ cause: "locked" }))
        : Effect.succeed(new TextDecoder().decode(value).replace(/^wrapped:/, "")),
    selectedStorageBackend: Effect.succeed(Option.fromNullishOr(options.backend)),
  });

const forHome = (safeStorage: ElectronSafeStorage.ElectronSafeStorage["Service"]) =>
  DesktopSecretsKey.make.pipe(
    Effect.provideService(ElectronSafeStorage.ElectronSafeStorage, safeStorage),
  );

const tempHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "cmdeck-desktop-key-" });
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("DesktopSecretsKey", (it) => {
  it.effect("creates a wrapped key once and unwraps the same key on the next start", () =>
    Effect.gen(function* () {
      const home = yield* tempHome;
      const keyFor = yield* forHome(fakeSafeStorage({}));
      const first = Option.getOrThrow(yield* keyFor(home));
      assert.equal(Buffer.from(first, "base64url").byteLength, 32);
      const wrapped = NodeFS.readFileSync(NodePath.join(home, "keys", "secrets.key.safestorage"));
      assert.equal(wrapped.toString(), `wrapped:${first}`);
      assert.deepEqual(yield* keyFor(home), Option.some(first));
    }),
  );

  it.effect("leaves a folder the server already keyed to the server", () =>
    Effect.gen(function* () {
      const home = yield* tempHome;
      NodeFS.mkdirSync(NodePath.join(home, "keys"));
      NodeFS.writeFileSync(NodePath.join(home, "keys", "secrets.key"), Buffer.alloc(32));
      assert.isTrue(Option.isNone(yield* (yield* forHome(fakeSafeStorage({})))(home)));
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, "keys", "secrets.key.safestorage")));
    }),
  );

  it.effect("hands over nothing when the keychain offers no protection", () =>
    Effect.gen(function* () {
      const home = yield* tempHome;
      for (const safeStorage of [
        fakeSafeStorage({ available: false }),
        fakeSafeStorage({ backend: "basic_text" }),
      ]) {
        assert.isTrue(Option.isNone(yield* (yield* forHome(safeStorage))(home)));
      }
      assert.isFalse(NodeFS.existsSync(NodePath.join(home, "keys")));
    }),
  );

  it.effect("a key the keychain cannot unwrap is not replaced", () =>
    Effect.gen(function* () {
      const home = yield* tempHome;
      NodeFS.mkdirSync(NodePath.join(home, "keys"));
      const wrappedPath = NodePath.join(home, "keys", "secrets.key.safestorage");
      NodeFS.writeFileSync(wrappedPath, "wrapped:old");
      const keyFor = yield* forHome(fakeSafeStorage({ decryptFails: true }));
      assert.isTrue(Option.isNone(yield* keyFor(home)));
      assert.equal(NodeFS.readFileSync(wrappedPath, "utf8"), "wrapped:old");
    }),
  );

  it.effect("adds the key to the bootstrap envelope only when there is one", () =>
    Effect.gen(function* () {
      const bootstrap: { readonly mode: string; readonly cmdeckSecretsKey?: string } = {
        mode: "desktop",
      };
      const config = { bootstrap, cwd: "/" };
      const withKey = yield* DesktopSecretsKey.withSecretsKey(
        () => Effect.succeedSome("abc"),
        "/home",
      )(config);
      assert.deepEqual(withKey.bootstrap, { mode: "desktop", cmdeckSecretsKey: "abc" });
      const without = yield* DesktopSecretsKey.withSecretsKey(
        () => Effect.succeedNone,
        "/home",
      )(config);
      assert.strictEqual(without, config);
    }),
  );
});
