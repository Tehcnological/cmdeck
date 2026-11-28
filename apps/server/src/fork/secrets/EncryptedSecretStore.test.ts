// @effect-diagnostics nodeBuiltinImport:off -- Inspects the raw files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as ServerConfig from "../../config.ts";
import * as T3Import from "../T3Import.ts";
import { makeSource } from "../T3Import.testkit.ts";
import * as EncryptedSecretStore from "./EncryptedSecretStore.ts";
import * as Envelope from "./envelope.ts";
import * as SecretsKey from "./SecretsKey.ts";

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const tempBase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "cmdeck-secrets-" }));
});

const paths = (baseDir: string) => ({
  secretsDir: NodePath.join(baseDir, "userdata", "secrets"),
  keysDir: NodePath.join(baseDir, "keys"),
});

/** One process start: a fresh layer build over `baseDir`, as the server or a CLI command does. */
const start = (baseDir: string, options: { readonly desktopKey?: Uint8Array } = {}) =>
  Effect.scoped(
    Layer.build(
      EncryptedSecretStore.layer.pipe(
        Layer.provide(
          Layer.effect(
            ServerConfig.ServerConfig,
            Effect.gen(function* () {
              const config = yield* ServerConfig.ServerConfig;
              return options.desktopKey === undefined
                ? config
                : {
                    ...config,
                    cmdeckSecretsKey: Redacted.make(
                      Buffer.from(options.desktopKey).toString("base64url"),
                    ),
                  };
            }),
          ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir))),
        ),
      ),
    ),
  ).pipe(Effect.map((context) => Context.get(context, EncryptedSecretStore.ServerSecretStore)));

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.exit(effect).pipe(
    Effect.map((exit) => {
      assert.isTrue(Exit.isFailure(exit), "expected the start to fail");
      return Exit.isFailure(exit) ? String(exit.cause) : "";
    }),
  );

/** A TPM stand-in: "seals" by XOR with a pad the fake keeps, and records every argv. */
const fakeSystemdCreds = (options: {
  readonly hasTpm2: boolean;
  readonly encryptFails?: boolean;
}) => {
  const calls: Array<{ readonly args: ReadonlyArray<string>; readonly input?: Uint8Array }> = [];
  const pad = Uint8Array.from({ length: 32 }, (_, index) => (index * 37 + 11) & 0xff);
  const xor = (bytes: Uint8Array) => bytes.map((byte, index) => byte ^ (pad[index] ?? 0));
  const run = (args: ReadonlyArray<string>, input?: Uint8Array) => {
    calls.push({ args, ...(input === undefined ? {} : { input }) });
    const fail = Effect.fail(
      new SecretsKey.SystemdCredsError({ command: args[0] ?? "", exitCode: 1 }),
    );
    switch (args[0]) {
      case "has-tpm2":
        return options.hasTpm2 ? Effect.succeed(new Uint8Array()) : fail;
      case "encrypt":
        return options.encryptFails || input === undefined
          ? fail
          : Effect.succeed(Uint8Array.from([0x54, ...xor(input)]));
      case "decrypt":
        return input === undefined || input[0] !== 0x54
          ? fail
          : Effect.succeed(xor(input.slice(1)));
      default:
        return fail;
    }
  };
  return { calls, run };
};

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("EncryptedSecretStore", (it) => {
  it.effect("round trip: values read back, files hold no plaintext, a restart reads them", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { secretsDir, keysDir } = paths(baseDir);
      const store = yield* start(baseDir);
      yield* store.set("provider-env-codex-OPENAI_API_KEY", text("sk-test-plaintext-value"));
      const signing = yield* store.getOrCreateRandom("server-signing-key", 32);

      const onDisk = NodeFS.readFileSync(
        NodePath.join(secretsDir, "provider-env-codex-OPENAI_API_KEY.bin"),
      );
      assert.isTrue(Envelope.isEnvelope(onDisk));
      assert.notInclude(onDisk.toString("latin1"), "sk-test-plaintext-value");
      assert.isTrue(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.KEY_FILE)));

      const restarted = yield* start(baseDir);
      const value = yield* restarted.get("provider-env-codex-OPENAI_API_KEY");
      assert.equal(decode(Option.getOrThrow(value)), "sk-test-plaintext-value");
      assert.deepEqual(yield* restarted.getOrCreateRandom("server-signing-key", 32), signing);
      assert.isTrue(Option.isNone(yield* restarted.get("missing")));
    }),
  );

  it.effect("a copied secrets directory cannot be read without the key", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      yield* (yield* start(baseDir)).set("token", text("value"));
      const elsewhere = yield* tempBase;
      NodeFS.cpSync(paths(baseDir).secretsDir, paths(elsewhere).secretsDir, { recursive: true });

      const message = yield* failure(start(elsewhere));
      assert.include(message, "no key was found");
      assert.isTrue(NodeFS.existsSync(NodePath.join(paths(elsewhere).secretsDir, "token.bin")));
    }),
  );

  it.effect("a file copied over another name does not open (the name is bound in)", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const store = yield* start(baseDir);
      yield* store.set("a", text("secret a"));
      yield* store.set("b", text("secret b"));
      const { secretsDir } = paths(baseDir);
      NodeFS.copyFileSync(NodePath.join(secretsDir, "a.bin"), NodePath.join(secretsDir, "b.bin"));

      const error = yield* Effect.flip(store.get("b"));
      assert.equal(error._tag, "SecretStoreDecodeError");
      assert.notInclude(error.message, "secret a");
    }),
  );

  it.effect("migrates plaintext secrets once, with a backup removed on the next good start", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { secretsDir, keysDir } = paths(baseDir);
      NodeFS.mkdirSync(secretsDir, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(secretsDir, "provider-env-x.bin"), "legacy value");
      NodeFS.writeFileSync(NodePath.join(secretsDir, "empty.bin"), "");

      const store = yield* start(baseDir);
      const migrated = NodeFS.readFileSync(NodePath.join(secretsDir, "provider-env-x.bin"));
      assert.isTrue(Envelope.isEnvelope(migrated));
      assert.equal(decode(Option.getOrThrow(yield* store.get("provider-env-x"))), "legacy value");
      const backups = NodeFS.readdirSync(keysDir).filter((entry) =>
        entry.startsWith("secrets-backup-"),
      );
      assert.equal(backups.length, 1);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(keysDir, backups[0]!, "provider-env-x.bin"), "utf8"),
        "legacy value",
      );
      // A 0-byte file from an older build is replaced, not encrypted.
      assert.equal((yield* store.getOrCreateRandom("empty", 16)).byteLength, 16);

      yield* start(baseDir);
      assert.deepEqual(
        NodeFS.readdirSync(keysDir).filter((entry) => entry.startsWith("secrets-backup-")),
        [],
      );
    }),
  );

  it.effect("a wrong key fails with recovery steps and leaves the secrets alone", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { secretsDir, keysDir } = paths(baseDir);
      yield* (yield* start(baseDir)).set("token", text("value"));
      const before = NodeFS.readFileSync(NodePath.join(secretsDir, "token.bin"));
      NodeFS.writeFileSync(NodePath.join(keysDir, SecretsKey.KEY_FILE), Buffer.alloc(32, 7));

      const message = yield* failure(start(baseDir));
      assert.include(message, "does not open any secret");
      assert.include(message, "Restore the key");
      assert.deepEqual(NodeFS.readFileSync(NodePath.join(secretsDir, "token.bin")), before);
    }),
  );

  it.effect("a missing key fails with recovery steps instead of creating a new one", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { keysDir } = paths(baseDir);
      yield* (yield* start(baseDir)).set("token", text("value"));
      NodeFS.rmSync(NodePath.join(keysDir, SecretsKey.KEY_FILE));

      const message = yield* failure(start(baseDir));
      assert.include(message, "no key was found");
      assert.include(message, "move");
      assert.isFalse(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.KEY_FILE)));
    }),
  );

  it.effect("a key file of the wrong length is refused", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      yield* (yield* start(baseDir)).set("token", text("value"));
      NodeFS.writeFileSync(NodePath.join(paths(baseDir).keysDir, SecretsKey.KEY_FILE), "short");

      assert.include(yield* failure(start(baseDir)), "wrong length");
    }),
  );

  it.effect("the desktop key opens the store; without it the error names the desktop app", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { keysDir } = paths(baseDir);
      const desktopKey = Uint8Array.from({ length: 32 }, (_, index) => index);
      NodeFS.mkdirSync(keysDir, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(keysDir, SecretsKey.DESKTOP_KEY_FILE), "wrapped");

      yield* (yield* start(baseDir, { desktopKey })).set("token", text("value"));
      assert.isFalse(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.KEY_FILE)));
      const reopened = yield* start(baseDir, { desktopKey });
      assert.equal(decode(Option.getOrThrow(yield* reopened.get("token"))), "value");

      assert.include(yield* failure(start(baseDir)), "CMDeck desktop");
    }),
  );

  it.effect("with a TPM2 the key is sealed by systemd-creds and never passed in argv", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { keysDir } = paths(baseDir);
      const fake = fakeSystemdCreds({ hasTpm2: true });
      const onLinux = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(SecretsKey.SystemdCreds, fake.run),
          Effect.provideService(HostProcess.Platform, "linux"),
        );

      yield* (yield* onLinux(start(baseDir))).set("token", text("value"));
      assert.isTrue(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.TPM_KEY_FILE)));
      assert.isFalse(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.KEY_FILE)));

      const reopened = yield* onLinux(start(baseDir));
      assert.equal(decode(Option.getOrThrow(yield* reopened.get("token"))), "value");
      assert.deepEqual(
        fake.calls.map((call) => call.args[0]),
        ["has-tpm2", "encrypt", "decrypt"],
      );
      const key = fake.calls.find((call) => call.args[0] === "encrypt")?.input;
      assert.equal(key?.byteLength, 32);
      for (const call of fake.calls) {
        assert.notInclude(call.args.join(" "), Buffer.from(key!).toString("base64url"));
      }

      // Off its TPM (another machine, or a reset TPM) the sealed key does not unseal.
      const otherMachine = fakeSystemdCreds({ hasTpm2: true });
      const message = yield* failure(
        start(baseDir).pipe(
          Effect.provideService(SecretsKey.SystemdCreds, (args, input) =>
            args[0] === "decrypt"
              ? otherMachine.run(args, Uint8Array.from([0]))
              : otherMachine.run(args, input),
          ),
          Effect.provideService(HostProcess.Platform, "linux"),
        ),
      );
      assert.include(message, "could not unseal");
    }),
  );

  it.effect("falls back to a key file when the TPM2 cannot seal", () =>
    Effect.gen(function* () {
      const baseDir = yield* tempBase;
      const { keysDir } = paths(baseDir);
      const fake = fakeSystemdCreds({ hasTpm2: true, encryptFails: true });
      yield* start(baseDir).pipe(
        Effect.provideService(SecretsKey.SystemdCreds, fake.run),
        Effect.provideService(HostProcess.Platform, "linux"),
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.KEY_FILE)));
      assert.isFalse(NodeFS.existsSync(NodePath.join(keysDir, SecretsKey.TPM_KEY_FILE)));
    }),
  );

  it.effect("import-from-t3 still drops install secrets; the user's secrets get encrypted", () =>
    Effect.gen(function* () {
      const root = yield* tempBase;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source).close();
      yield* (yield* T3Import.T3Import).run({ source, target, force: false });

      const store = yield* start(target);
      const { secretsDir } = paths(target);
      assert.deepEqual(NodeFS.readdirSync(secretsDir).sort(), [
        "provider-env-codex-OPENAI_API_KEY.bin",
        "secret-request-salt.bin",
      ]);
      for (const file of NodeFS.readdirSync(secretsDir)) {
        assert.isTrue(Envelope.isEnvelope(NodeFS.readFileSync(NodePath.join(secretsDir, file))));
      }
      assert.equal(
        decode(Option.getOrThrow(yield* store.get("provider-env-codex-OPENAI_API_KEY"))),
        "value of provider-env-codex-OPENAI_API_KEY",
      );
    }).pipe(Effect.provide(T3Import.layer)),
  );
});
