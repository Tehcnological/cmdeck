// Secrets at rest (WI-2.17). Files that build the store import this module in place of
// `auth/ServerSecretStore.ts` (scripts/fork/guard.sh enforces it), so the server and every CLI
// command read and write the secrets directory through the same key.
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";

import * as Base from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as Envelope from "./envelope.ts";
import * as SecretsKey from "./SecretsKey.ts";

export * from "../../auth/ServerSecretStore.ts";

const BACKUP_PREFIX = "secrets-backup-";
const SECRET_SUFFIX = ".bin";

const secretNameOf = (file: string) =>
  file.endsWith(SECRET_SUFFIX) ? file.slice(0, -SECRET_SUFFIX.length) : undefined;

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

const make = Effect.gen(function* () {
  const base = yield* Base.ServerSecretStore;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const keysDir = path.join(config.baseDir, SecretsKey.KEYS_DIR_NAME);

  const stored = yield* Effect.forEach(
    (yield* fileSystem.readDirectory(config.secretsDir)).flatMap((file) => {
      const name = secretNameOf(file);
      return name === undefined ? [] : [name];
    }),
    (name) => base.get(name).pipe(Effect.map((bytes) => ({ name, bytes }))),
    { concurrency: 16 },
  );
  const present = stored.flatMap(({ name, bytes }) =>
    Option.isSome(bytes) ? [{ name, bytes: bytes.value }] : [],
  );
  const envelopes = present.filter(({ bytes }) => Envelope.isEnvelope(bytes));
  // Older builds could leave a 0-byte file; getOrCreateRandom below replaces it.
  const plaintext = present.filter(
    ({ bytes }) => bytes.byteLength > 0 && !Envelope.isEnvelope(bytes),
  );

  const { key, source } = yield* SecretsKey.resolve({
    baseDir: config.baseDir,
    secretsDir: config.secretsDir,
    desktopKey:
      config.cmdeckSecretsKey === undefined ? undefined : Redacted.value(config.cmdeckSecretsKey),
    hasEncryptedSecrets: envelopes.length > 0,
  });

  const unreadable = envelopes.filter(
    ({ name, bytes }) => Envelope.open(key, name, bytes) === undefined,
  );
  if (envelopes.length > 0 && unreadable.length === envelopes.length) {
    return yield* new SecretsKey.SecretsKeyError({
      problem: `The secrets key (${source}) does not open any secret in ${config.secretsDir}.`,
      recovery: `Restore the key that encrypted them into ${keysDir}${source === "desktop" ? " and remove secrets.key.safestorage there" : ""}, or restore the secrets from a backup. If the key is lost, move ${config.secretsDir} aside and start CMDeck again: it creates a new key, and you sign in to providers and pair devices again.`,
    });
  }
  if (unreadable.length > 0) {
    yield* Effect.logWarning("Some secrets did not open with the secrets key and are unusable.", {
      unreadable: unreadable.length,
    });
  }

  // A backup from an earlier migration has served its purpose once this key opens every secret.
  if (unreadable.length === 0) {
    const backups = (yield* fileSystem
      .readDirectory(keysDir)
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))).filter((entry) =>
      entry.startsWith(BACKUP_PREFIX),
    );
    yield* Effect.forEach(backups, (entry) =>
      fileSystem.remove(path.join(keysDir, entry), { recursive: true }).pipe(
        Effect.tap(() => Effect.logInfo("Removed the plaintext secrets backup.", { entry })),
        Effect.catch((cause) =>
          Effect.logWarning("Could not remove the plaintext secrets backup.", { entry, cause }),
        ),
      ),
    );
  }

  if (plaintext.length > 0) {
    const stamp = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)).replace(
      /[:.]/g,
      "-",
    );
    const backupDir = path.join(keysDir, `${BACKUP_PREFIX}${stamp}`);
    yield* fileSystem.makeDirectory(backupDir, { recursive: true, mode: 0o700 });
    yield* fileSystem.chmod(backupDir, 0o700);
    yield* Effect.forEach(plaintext, ({ name, bytes }) =>
      fileSystem
        .writeFile(path.join(backupDir, `${name}${SECRET_SUFFIX}`), bytes, { mode: 0o600 })
        .pipe(
          Effect.andThen(fileSystem.chmod(path.join(backupDir, `${name}${SECRET_SUFFIX}`), 0o600)),
        ),
    );
    yield* Effect.forEach(plaintext, ({ name, bytes }) =>
      Effect.gen(function* () {
        // Another process may have rewritten it since the scan; leave its newer value alone.
        const current = yield* base.get(name);
        if (Option.isNone(current) || !sameBytes(current.value, bytes)) return;
        yield* base.set(name, Envelope.seal(key, name, bytes));
        const written = yield* base.get(name);
        const reopened = Option.isSome(written)
          ? Envelope.open(key, name, written.value)
          : undefined;
        if (reopened === undefined || !sameBytes(reopened, bytes)) {
          yield* base.set(name, bytes);
          return yield* new Base.SecretStorePersistError({
            resource: `secret ${name}`,
            cause: "the encrypted copy did not read back",
          });
        }
      }),
    );
    yield* Effect.logInfo(
      "Encrypted the secrets stored in plaintext. The plaintext backup is removed on the next start that opens every secret.",
      { secrets: plaintext.length, backupDir, keySource: source },
    );
  }

  const open = (
    name: string,
    bytes: Uint8Array,
  ): Effect.Effect<Uint8Array, Base.SecretStoreDecodeError> => {
    // A file written before this build, or copied in by an import, migrates on the next start.
    if (!Envelope.isEnvelope(bytes)) return Effect.succeed(bytes);
    const plain = Envelope.open(key, name, bytes);
    return plain === undefined
      ? Effect.fail(
          new Base.SecretStoreDecodeError({
            resource: `secret ${name}`,
            cause: "the secrets key does not open this secret",
          }),
        )
      : Effect.succeed(plain);
  };

  const get: Base.ServerSecretStore["Service"]["get"] = (name) =>
    base.get(name).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (bytes) => open(name, bytes).pipe(Effect.asSome),
        }),
      ),
    );
  const set: Base.ServerSecretStore["Service"]["set"] = (name, value) =>
    base.set(name, Envelope.seal(key, name, value));
  const create: Base.ServerSecretStore["Service"]["create"] = (name, value) =>
    base.create(name, Envelope.seal(key, name, value));

  const emptySecretRepair = yield* Semaphore.make(1);
  const generate = (name: string, bytes: number) =>
    random.randomBytes(bytes).pipe(
      Effect.mapError(
        (cause) => new Base.SecretStoreRandomGenerationError({ resource: `secret ${name}`, cause }),
      ),
      Effect.flatMap((generated) =>
        create(name, generated).pipe(
          Effect.as(Uint8Array.from(generated)),
          Effect.catchIf(Base.isSecretAlreadyExistsError, () =>
            get(name).pipe(
              Effect.flatMap(
                Option.match({
                  onSome: Effect.succeed,
                  onNone: () =>
                    Effect.fail(
                      new Base.SecretStoreConcurrentReadError({ resource: `secret ${name}` }),
                    ),
                }),
              ),
            ),
          ),
        ),
      ),
    );
  // Same contract as the upstream store, including its repair of 0-byte files from older builds.
  const getOrCreateRandom: Base.ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap((existing) =>
        Option.isSome(existing) && existing.value.byteLength > 0
          ? Effect.succeed(existing.value)
          : Option.isNone(existing)
            ? generate(name, bytes)
            : emptySecretRepair.withPermits(1)(
                get(name).pipe(
                  Effect.flatMap((again) =>
                    Option.isSome(again) && again.value.byteLength > 0
                      ? Effect.succeed(again.value)
                      : (Option.isSome(again) ? base.remove(name) : Effect.void).pipe(
                          Effect.andThen(generate(name, bytes)),
                        ),
                  ),
                  Effect.uninterruptible,
                ),
              ),
      ),
      Effect.withSpan("EncryptedSecretStore.getOrCreateRandom"),
    );

  return Base.ServerSecretStore.of({
    ...(base.directory === undefined ? {} : { directory: base.directory }),
    get,
    set,
    create,
    getOrCreateRandom,
    remove: base.remove,
  });
});

/** Replaces `auth/ServerSecretStore.ts`'s `layer` for every file that imports this module. */
export const layer = Layer.effect(Base.ServerSecretStore, make).pipe(Layer.provide(Base.layer));
