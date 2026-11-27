// @effect-diagnostics nodeBuiltinImport:off - systemd-creds needs stdin and stdout, and the runner must not add a layer requirement.
import * as NodeChildProcess from "node:child_process";

import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { KEY_BYTES } from "./envelope.ts";

export const KEYS_DIR_NAME = "keys";
/** The raw key, mode 0600, when there is no TPM2 and no desktop app. */
export const KEY_FILE = "secrets.key";
/** The key sealed by `systemd-creds encrypt --with-key=tpm2`. */
export const TPM_KEY_FILE = "secrets.key.cred";
/** The key wrapped with Electron safeStorage. The desktop app owns it; the server only checks it exists. */
export const DESKTOP_KEY_FILE = "secrets.key.safestorage";
const CREDENTIAL_NAME = "cmdeck-secrets";

export type SecretsKeySource = "desktop" | "tpm2" | "file";

export class SecretsKeyError extends Schema.TaggedError<SecretsKeyError>()("SecretsKeyError", {
  problem: Schema.String,
  recovery: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.problem} ${this.recovery}`;
  }
}

export class SystemdCredsError extends Schema.TaggedError<SystemdCredsError>()(
  "SystemdCredsError",
  {
    command: Schema.String,
    exitCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `systemd-creds ${this.command} failed${this.exitCode === undefined ? "" : ` with exit code ${this.exitCode}`}.`;
  }
}

/** Runs `systemd-creds` and returns its stdout; key material only travels over stdin and stdout. */
export const SystemdCreds = Context.Reference<
  (args: ReadonlyArray<string>, input?: Uint8Array) => Effect.Effect<Uint8Array, SystemdCredsError>
>("cmdeck/fork/secrets/SystemdCreds", {
  defaultValue: () => (args, input) =>
    Effect.callback<Uint8Array, SystemdCredsError>((resume) => {
      const command = args[0] ?? "";
      const child = NodeChildProcess.spawn("systemd-creds", [...args], {
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 30_000,
      });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", (cause) => resume(Effect.fail(new SystemdCredsError({ command, cause }))));
      child.on("close", (code) =>
        resume(
          code === 0
            ? Effect.succeed(Uint8Array.from(Buffer.concat(chunks)))
            : Effect.fail(new SystemdCredsError({ command, exitCode: code ?? -1 })),
        ),
      );
      child.stdin.end(input === undefined ? undefined : Buffer.from(input));
      return Effect.sync(() => child.kill());
    }),
});

const hasTpm2 = Effect.gen(function* () {
  if ((yield* HostProcess.Platform) !== "linux") return false;
  const run = yield* SystemdCreds;
  return yield* run(["has-tpm2", "--quiet"]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
});

const exists = Effect.fn("SecretsKey.exists")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));
});

const readIfPresent = Effect.fn("SecretsKey.readIfPresent")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFile(file).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
  );
});

export interface ResolveInput {
  readonly baseDir: string;
  readonly secretsDir: string;
  /** base64url, handed over by the desktop app in the bootstrap envelope. */
  readonly desktopKey: string | undefined;
  readonly hasEncryptedSecrets: boolean;
}

export interface ResolvedKey {
  readonly key: Uint8Array;
  readonly source: SecretsKeySource;
}

/**
 * The key for the secrets in `secretsDir`. Without one it creates a key only while no secret is
 * encrypted yet, the same guard as Kiro Crew's vault: a new key would orphan every existing secret.
 */
export const resolve = Effect.fn("SecretsKey.resolve")(function* (input: ResolveInput) {
  const path = yield* Path.Path;
  const keysDir = path.join(input.baseDir, KEYS_DIR_NAME);
  const restoreOrReset = `If the key is lost, move ${input.secretsDir} aside and start CMDeck again: it creates a new key, and you sign in to providers and pair devices again.`;
  const checkLength = (key: Uint8Array, from: string) =>
    key.byteLength === KEY_BYTES
      ? Effect.succeed(key)
      : Effect.fail(
          new SecretsKeyError({
            problem: `The secrets key in ${from} has the wrong length.`,
            recovery: `Restore the original file from a backup. ${restoreOrReset}`,
          }),
        );

  if (input.desktopKey !== undefined) {
    const key = Uint8Array.from(Buffer.from(input.desktopKey, "base64url"));
    const resolved: ResolvedKey = {
      key: yield* checkLength(key, "the desktop app's handoff"),
      source: "desktop",
    };
    return resolved;
  }

  const readStored = Effect.gen(function* () {
    const tpmPath = path.join(keysDir, TPM_KEY_FILE);
    const sealed = yield* readIfPresent(tpmPath);
    if (Option.isSome(sealed)) {
      const run = yield* SystemdCreds;
      const key = yield* run(["decrypt", `--name=${CREDENTIAL_NAME}`, "-", "-"], sealed.value).pipe(
        Effect.mapError(
          (cause) =>
            new SecretsKeyError({
              problem: `The TPM2 could not unseal the secrets key in ${tpmPath}.`,
              recovery: `Run CMDeck on the machine that sealed it, with systemd-creds installed. A reset TPM or a disk moved to another machine cannot unseal it. ${restoreOrReset}`,
              cause,
            }),
        ),
      );
      return Option.some<ResolvedKey>({ key: yield* checkLength(key, tpmPath), source: "tpm2" });
    }
    const keyPath = path.join(keysDir, KEY_FILE);
    const plain = yield* readIfPresent(keyPath);
    if (Option.isSome(plain)) {
      return Option.some<ResolvedKey>({
        key: yield* checkLength(plain.value, keyPath),
        source: "file",
      });
    }
    return Option.none<ResolvedKey>();
  });

  const stored = yield* readStored;
  if (Option.isSome(stored)) return stored.value;

  if (yield* exists(path.join(keysDir, DESKTOP_KEY_FILE))) {
    return yield* new SecretsKeyError({
      problem: `The secrets in ${input.secretsDir} are encrypted with a key the CMDeck desktop app keeps in the OS keychain.`,
      recovery: `Start CMDeck desktop for this data folder; commands run outside the app cannot read its secrets. If the desktop app itself shows this, the OS keychain could not unwrap the key (for example after an OS reinstall or a new user profile). ${restoreOrReset}`,
    });
  }
  if (input.hasEncryptedSecrets) {
    return yield* new SecretsKeyError({
      problem: `The secrets in ${input.secretsDir} are encrypted, but no key was found in ${keysDir}.`,
      recovery: `Restore ${KEY_FILE} or ${TPM_KEY_FILE} into ${keysDir} from a backup. ${restoreOrReset}`,
    });
  }

  return yield* create(keysDir).pipe(
    // Another process published a key first: use that one.
    Effect.catchReason("PlatformError", "AlreadyExists", () =>
      readStored.pipe(
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () =>
              Effect.fail(
                new SecretsKeyError({
                  problem: `Another process was creating the secrets key in ${keysDir}.`,
                  recovery: "Start CMDeck again.",
                }),
              ),
          }),
        ),
      ),
    ),
  );
});

const create = Effect.fn("SecretsKey.create")(function* (keysDir: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(keysDir, { recursive: true, mode: 0o700 });
  yield* fileSystem.chmod(keysDir, 0o700);
  const key = yield* (yield* SecureRandom.SecureRandom).randomBytes(KEY_BYTES);

  if (yield* hasTpm2) {
    const run = yield* SystemdCreds;
    const sealed = yield* run(
      ["encrypt", "--with-key=tpm2", `--name=${CREDENTIAL_NAME}`, "-", "-"],
      key,
    ).pipe(
      Effect.filterOrFail(
        (bytes) => bytes.byteLength > 0,
        () => new SystemdCredsError({ command: "encrypt" }),
      ),
      Effect.tapError((cause) =>
        Effect.logWarning("The TPM2 could not seal the secrets key; using a key file instead.", {
          cause,
        }),
      ),
      Effect.option,
    );
    if (Option.isSome(sealed)) {
      yield* publish(path.join(keysDir, TPM_KEY_FILE), sealed.value);
      const resolved: ResolvedKey = { key, source: "tpm2" };
      return resolved;
    }
  }
  yield* publish(path.join(keysDir, KEY_FILE), key);
  const resolved: ResolvedKey = { key, source: "file" };
  return resolved;
});

/** Writes a complete file under its final name, or fails with AlreadyExists if one is there. */
const publish = Effect.fn("SecretsKey.publish")(function* (file: string, bytes: Uint8Array) {
  const fileSystem = yield* FileSystem.FileSystem;
  const temp = `${file}.${yield* (yield* SecureRandom.SecureRandom).uuidV4()}.tmp`;
  yield* Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* fileSystem.open(temp, { flag: "wx", mode: 0o600 });
        yield* handle.writeAll(bytes);
        yield* handle.sync;
      }),
    );
    yield* fileSystem.chmod(temp, 0o600);
    yield* fileSystem.link(temp, file);
  }).pipe(Effect.ensuring(fileSystem.remove(temp).pipe(Effect.ignore)));
});
