// @effect-diagnostics nodeBuiltinImport:off -- Builds source data folders with node:sqlite and hashes them with node:crypto.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { formatImportPlan } from "../cli/importFromT3.ts";
import { BUILD_MIGRATION_HEAD } from "../persistence/databaseMigrationHead.ts";
import { migrationManifest } from "../persistence/Migrations.ts";
import { holdServerOwnershipLock } from "../serverOwnership.ts";
import * as T3Import from "./T3Import.ts";

const write = (file: string, contents: string) => {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, contents);
};

/** Every file under `dir` with its hash. SQLite gives any reader a `-shm` and, for a closed WAL
 * database, an empty `-wal`; neither holds data. */
const hashTree = (dir: string): Record<string, string> => {
  const hashes: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of NodeFS.readdirSync(at, { withFileTypes: true })) {
      const full = NodePath.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        !entry.name.endsWith("-shm") &&
        !(entry.name.endsWith("-wal") && NodeFS.statSync(full).size === 0)
      ) {
        hashes[NodePath.relative(dir, full)] = NodeCrypto.createHash("sha256")
          .update(NodeFS.readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(dir);
  return hashes;
};

/** A T3 Code data folder at `schema`, whose database stays open in WAL mode until `close`. */
const makeSource = (base: string, schema: number = BUILD_MIGRATION_HEAD) => {
  const userdata = NodePath.join(base, "userdata");
  NodeFS.mkdirSync(userdata, { recursive: true });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
  db.exec("CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT)");
  const insert = db.prepare("INSERT INTO effect_sql_migrations VALUES (?, ?)");
  for (const [id, name] of migrationManifest) if (id <= schema) insert.run(id, name);
  if (schema > BUILD_MIGRATION_HEAD) insert.run(schema, "FromTheFuture");
  db.exec(`
    CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY);
    CREATE TABLE auth_sessions (session_id TEXT PRIMARY KEY);
    CREATE TABLE auth_pairing_links (id TEXT PRIMARY KEY);
    CREATE TABLE auth_connect_devices (proof_key_thumbprint TEXT PRIMARY KEY);
    CREATE TABLE peer_environment_links (environment_id TEXT PRIMARY KEY);
    INSERT INTO orchestration_v2_projection_threads VALUES ('thread-1'), ('thread-2');
    INSERT INTO auth_sessions VALUES ('phone');
    INSERT INTO auth_pairing_links VALUES ('link');
    INSERT INTO auth_connect_devices VALUES ('device');
    INSERT INTO peer_environment_links VALUES ('peer');
  `);
  write(NodePath.join(userdata, "settings.json"), '{"enableAssistantStreaming":true}\n');
  write(NodePath.join(userdata, "keybindings.json"), "[]\n");
  write(NodePath.join(userdata, "environment-id"), "old-environment\n");
  write(NodePath.join(userdata, "server-runtime.json"), "{}\n");
  write(NodePath.join(userdata, "attachments", "a.png"), "png");
  write(NodePath.join(userdata, "logs", "server.log"), "log");
  write(NodePath.join(userdata, "providers", "codex", "work", "shadow", "auth.json"), "{}");
  for (const name of [
    "provider-env-codex-OPENAI_API_KEY",
    "secret-request-salt",
    "server-signing-key",
    "guest-share-signing-key",
    "remote-mcp-tokens",
    "cloud-relay-url",
    "peer-link-abc",
    "dpop-proof-xyz",
  ]) {
    write(NodePath.join(userdata, "secrets", `${name}.bin`), `value of ${name}`);
  }
  write(NodePath.join(base, "workflows", "nightly.ts"), "export default {}");
  write(NodePath.join(base, "worktrees", "repo", "file.txt"), "worktree");
  write(NodePath.join(base, "caches", "c.json"), "{}");
  write(NodePath.join(base, "runtime", "versions", "1.0.0", "server.js"), "");
  return { userdata, close: () => db.close() };
};

const rowCount = (databasePath: string, table: string) => {
  const db = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
  } finally {
    db.close();
  }
};

const tempRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-import-" }));
});

it.layer(T3Import.layer.pipe(Layer.provideMerge(NodeServices.layer)))("T3Import", (it) => {
  it.effect("dry run reports every item and writes nothing", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      const sourceDb = makeSource(source);
      const plan = yield* (yield* T3Import.T3Import).plan({ source, target });
      sourceDb.close();

      const actions = Object.fromEntries(plan.items.map((item) => [item.name, item.action]));
      assert.equal(actions["userdata/statev2.sqlite"], "transform");
      assert.equal(actions["userdata/secrets"], "transform");
      assert.equal(actions["userdata/settings.json"], "copy");
      assert.equal(actions["userdata/providers"], "copy");
      assert.equal(actions["workflows"], "copy");
      assert.equal(actions["userdata/environment-id"], "skip");
      assert.equal(actions["userdata/logs"], "skip");
      assert.equal(actions["worktrees"], "skip");
      assert.equal(actions["runtime"], "skip");
      assert.include(
        plan.items.find((item) => item.name === "userdata/secrets")?.reason,
        "2 copied, 6 left out",
      );
      assert.equal(plan.sourceSchema, BUILD_MIGRATION_HEAD);
      assert.deepEqual(plan.blockers, []);
      assert.isFalse(plan.targetHasData);
      assert.isAbove(plan.bytes, 0);
      assert.isFalse(NodeFS.existsSync(target));
      assert.include(formatImportPlan(plan), "userdata/statev2.sqlite");
    }),
  );

  it.effect("refuses a database newer than this build", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source, BUILD_MIGRATION_HEAD + 1).close();
      const importer = yield* T3Import.T3Import;

      const plan = yield* importer.plan({ source, target });
      assert.lengthOf(plan.blockers, 1);
      assert.include(plan.blockers[0], "newer than this CMDeck build");
      assert.include(formatImportPlan(plan), "Cannot import:");
      const failure = yield* Effect.flip(importer.run({ source, target, force: true }));
      assert.equal(failure._tag, "T3ImportRefusedError");
      assert.isFalse(NodeFS.existsSync(target));
    }),
  );

  it.effect("imports an older database and leaves the upgrade to the next start", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source, BUILD_MIGRATION_HEAD - 1).close();
      const result = yield* (yield* T3Import.T3Import).run({ source, target, force: false });
      assert.equal(result.plan.sourceSchema, BUILD_MIGRATION_HEAD - 1);
      assert.include(result.plan.notes.join(" "), "upgrades the copy");
      assert.equal(
        rowCount(NodePath.join(target, "userdata", "statev2.sqlite"), "effect_sql_migrations"),
        migrationManifest.filter(([id]) => id <= BUILD_MIGRATION_HEAD - 1).length,
      );
    }),
  );

  it.effect("copies a consistent snapshot while the source database is open", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      const sourceDb = makeSource(source);
      // The rows live only in the WAL until a checkpoint, which this open connection never runs.
      assert.isAbove(NodeFS.statSync(NodePath.join(sourceDb.userdata, "statev2.sqlite-wal")).size, 0);
      const before = hashTree(source);

      yield* (yield* T3Import.T3Import).run({ source, target, force: false });

      assert.deepEqual(hashTree(source), before);
      sourceDb.close();
      const imported = NodePath.join(target, "userdata", "statev2.sqlite");
      assert.equal(rowCount(imported, "orchestration_v2_projection_threads"), 2);
      assert.isFalse(NodeFS.existsSync(`${imported}-wal`));
    }),
  );

  it.effect("gives the import a new identity and keeps only the user's data", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source).close();
      const before = hashTree(source);

      const result = yield* (yield* T3Import.T3Import).run({ source, target, force: false });

      assert.deepEqual(hashTree(source), before);
      assert.deepEqual(result.removedRows, {
        auth_sessions: 1,
        auth_pairing_links: 1,
        auth_connect_devices: 1,
        peer_environment_links: 1,
      });
      const userdata = NodePath.join(target, "userdata");
      for (const table of Object.keys(result.removedRows)) {
        assert.equal(rowCount(NodePath.join(userdata, "statev2.sqlite"), table), 0);
      }
      assert.deepEqual(NodeFS.readdirSync(NodePath.join(userdata, "secrets")).sort(), [
        "provider-env-codex-OPENAI_API_KEY.bin",
        "secret-request-salt.bin",
      ]);
      assert.equal(
        NodeFS.readFileSync(NodePath.join(userdata, "settings.json"), "utf8"),
        '{"enableAssistantStreaming":true}\n',
      );
      for (const kept of [
        "keybindings.json",
        "attachments/a.png",
        "providers/codex/work/shadow/auth.json",
      ]) {
        assert.isTrue(NodeFS.existsSync(NodePath.join(userdata, kept)), kept);
      }
      assert.isTrue(NodeFS.existsSync(NodePath.join(target, "workflows", "nightly.ts")));
      for (const skipped of [
        "userdata/environment-id",
        "userdata/server-runtime.json",
        "userdata/logs",
        "worktrees",
        "caches",
        "runtime",
      ]) {
        assert.isFalse(NodeFS.existsSync(NodePath.join(target, skipped)), skipped);
      }
      assert.deepEqual(
        NodeFS.readdirSync(target).filter((entry) => entry.startsWith(".")),
        [],
      );
    }),
  );

  it.effect("refuses a target with data unless forced, then backs it up", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source).close();
      write(NodePath.join(target, "userdata", "statev2.sqlite"), "cmdeck's own database");
      write(NodePath.join(target, "workflows", "mine.ts"), "mine");
      const importer = yield* T3Import.T3Import;

      const refused = yield* Effect.flip(importer.run({ source, target, force: false }));
      assert.equal(refused._tag, "T3ImportRefusedError");
      assert.include(refused.message, "--force");
      assert.equal(
        NodeFS.readFileSync(NodePath.join(target, "userdata", "statev2.sqlite"), "utf8"),
        "cmdeck's own database",
      );

      const result = yield* importer.run({ source, target, force: true });
      assert.lengthOf(result.backups, 2);
      const [userdataBackup = "", workflowsBackup = ""] = result.backups;
      assert.equal(
        NodeFS.readFileSync(NodePath.join(userdataBackup, "statev2.sqlite"), "utf8"),
        "cmdeck's own database",
      );
      assert.isTrue(NodeFS.existsSync(NodePath.join(workflowsBackup, "mine.ts")));
      assert.equal(
        rowCount(
          NodePath.join(target, "userdata", "statev2.sqlite"),
          "orchestration_v2_projection_threads",
        ),
        2,
      );
    }),
  );

  it.effect("refuses while CMDeck runs on the target", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source).close();
      const importer = yield* T3Import.T3Import;
      yield* holdServerOwnershipLock(NodePath.join(target, "userdata", "statev2.sqlite"));

      const plan = yield* importer.plan({ source, target });
      assert.include(plan.blockers.join(" "), "CMDeck is running");
      const exit = yield* Effect.exit(importer.run({ source, target, force: true }));
      assert.isTrue(Exit.isFailure(exit));
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to import a folder into itself", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      makeSource(source).close();
      const plan = yield* (yield* T3Import.T3Import).plan({ source, target: source });
      assert.include(plan.blockers.join(" "), "are the same");
    }),
  );

  it.effect("leaves the target as it was when the import fails", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "not-a-folder");
      makeSource(source).close();
      write(target, "a file where the data folder should be");

      const failure = yield* Effect.flip(
        (yield* T3Import.T3Import).run({ source, target, force: false }),
      );
      assert.instanceOf(failure, T3Import.T3ImportFailedError);
      assert.equal(NodeFS.readFileSync(target, "utf8"), "a file where the data folder should be");
    }),
  );

  it.effect("treats install keys as the install's, not the user's", () =>
    Effect.sync(() => {
      for (const name of [
        "server-signing-key",
        "asset-access-signing-key",
        "mcp-oauth-signing-key",
        "remote-mcp-tokens",
        "cloud-link-ed25519-key-pair",
        "peer-link-0f",
        "dpop-proof-abc",
      ]) {
        assert.isTrue(T3Import.isInstallSecret(name), name);
      }
      for (const name of ["provider-env-codex-KEY", "secret-request-salt"]) {
        assert.isFalse(T3Import.isInstallSecret(name), name);
      }
    }),
  );
});
