/**
 * The key that encrypts the local backend's secrets at rest (WI-2.17), kept wrapped with Electron
 * safeStorage (DPAPI, Keychain, libsecret/KWallet) in `<data folder>/keys/secrets.key.safestorage`.
 * The app unwraps it at each start and hands it to the backend inside the bootstrap envelope on
 * fd 3, never in argv or the environment, which agents and other children inherit.
 */
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const KEYS_DIR_NAME = "keys";
const WRAPPED_KEY_FILE = "secrets.key.safestorage";
// A key file the server made (headless start on this folder) or a TPM2-sealed one stays in charge.
const SERVER_KEY_FILES = ["secrets.key", "secrets.key.cred"];
const KEY_BYTES = 32;

/** The base64url key for the backend that uses `baseDir`, or none to let it use its own key file. */
export const DesktopSecretsKey = Context.Reference<
  (baseDir: string) => Effect.Effect<Option.Option<string>>
>("cmdeck/desktop/DesktopSecretsKey", { defaultValue: () => () => Effect.succeedNone });

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

  const usable = Effect.gen(function* () {
    if (!(yield* safeStorage.isEncryptionAvailable)) return false;
    // Chromium's "basic_text" backend on Linux stores the value with a fixed key: no protection.
    const backend = yield* safeStorage.selectedStorageBackend;
    return !(Option.isSome(backend) && backend.value === "basic_text");
  });

  return Effect.fn("DesktopSecretsKey.forHome")(
    function* (baseDir: string) {
      const keysDir = path.join(baseDir, KEYS_DIR_NAME);
      const wrappedPath = path.join(keysDir, WRAPPED_KEY_FILE);
      const wrapped = yield* fileSystem.readFile(wrappedPath).pipe(
        Effect.asSome,
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
      );
      if (Option.isSome(wrapped)) {
        // A failure here reaches the backend as a missing key, which refuses to start and says why.
        return Option.some(yield* safeStorage.decryptString(wrapped.value));
      }
      for (const file of SERVER_KEY_FILES) {
        if (yield* fileSystem.exists(path.join(keysDir, file))) return Option.none<string>();
      }
      if (!(yield* usable)) return Option.none<string>();

      const key = Buffer.from(yield* random.randomBytes(KEY_BYTES)).toString("base64url");
      const sealed = yield* safeStorage.encryptString(key);
      yield* fileSystem.makeDirectory(keysDir, { recursive: true, mode: 0o700 });
      yield* fileSystem.chmod(keysDir, 0o700);
      yield* fileSystem.writeFile(wrappedPath, sealed, { flag: "wx", mode: 0o600 });
      return Option.some(key);
    },
    (effect) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not prepare the secrets key for the local backend.", {
            cause,
          }).pipe(Effect.as(Option.none<string>())),
        ),
      ),
  );
});

export const layer = Layer.effect(DesktopSecretsKey, make);

/** Adds the key to a backend start config's bootstrap envelope. */
export const withSecretsKey =
  (forHome: (baseDir: string) => Effect.Effect<Option.Option<string>>, baseDir: string) =>
  <C extends { readonly bootstrap: object }>(config: C): Effect.Effect<C> =>
    forHome(baseDir).pipe(
      Effect.map(
        Option.match({
          onNone: () => config,
          onSome: (cmdeckSecretsKey) => ({
            ...config,
            bootstrap: { ...config.bootstrap, cmdeckSecretsKey },
          }),
        }),
      ),
    );
