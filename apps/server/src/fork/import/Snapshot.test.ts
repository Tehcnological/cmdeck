// @effect-diagnostics nodeBuiltinImport:off -- Builds and inspects the temp data folders the snapshot reads and writes.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeCli } from "../../binCli.ts";
import { BUILD_MIGRATION_HEAD } from "../../persistence/databaseMigrationHead.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { write } from "../T3Import.testkit.ts";
import * as Snapshot from "./Snapshot.ts";

const OPENAI_KEY = "sk-proj-SnapshotTestKey0123456789abcdef";
const GITHUB_TOKEN = `ghp_${"a1B2".repeat(9)}`;

const tempRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-snapshot-" }));
});

const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    yield* Command.runWith(makeCli(), { version: "0.0.0" })(args);
    return (yield* TestConsole.logLines).slice(before).join("\n");
  });

/** Inserts a row, filling NOT NULL columns the test does not care about. */
const insert = (db: NodeSqlite.DatabaseSync, table: string, values: Record<string, unknown>) => {
  const row: Record<string, unknown> = { ...values };
  for (const column of db.prepare("SELECT * FROM pragma_table_info(?)").all(table)) {
    const name = String(column.name);
    if (name in row || column.notnull === 0 || column.dflt_value !== null || column.pk === 1) {
      continue;
    }
    row[name] = /INT/i.test(String(column.type)) ? 0 : `${name}-value`;
  }
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...(Object.values(row) as Array<NodeSqlite.SQLInputValue>));
};

/** A CMDeck data folder with a fully migrated database holding a thread, memory, a bot and secrets. */
const makeHome = (base: string) =>
  Effect.gen(function* () {
    const userdata = NodePath.join(base, "userdata");
    const dbPath = NodePath.join(userdata, "statev2.sqlite");
    yield* Effect.scoped(Layer.build(SqlitePersistence.layerFromPath(dbPath)));
    const db = new NodeSqlite.DatabaseSync(dbPath);
    try {
      insert(db, "orchestration_v2_projection_threads", {
        thread_id: "thread-1",
        title: "Snapshot thread",
        payload_json: "{}",
      });
      insert(db, "orchestration_v2_projection_messages", {
        message_id: "message-1",
        thread_id: "thread-1",
        role: "user",
        streaming: 0,
        payload_json: JSON.stringify({ text: `use ${OPENAI_KEY} with Authorization: Bearer x` }),
      });
      insert(db, "memory_items", {
        id: "memory-1",
        content: `deploy token ${GITHUB_TOKEN}`,
        status: "active",
      });
      insert(db, "bot_profiles", { id: "bot-1", name: "Helper", thread_id: "thread-1" });
      insert(db, "auth_sessions", { session_id: "phone" });
      insert(db, "workflow_hooks", { hook_id: "hook-1", token: "hook-secret" });
    } finally {
      db.close();
    }
    write(
      NodePath.join(userdata, "settings.json"),
      `${JSON.stringify({ enableAssistantStreaming: true, providerEnv: { OPENAI_API_KEY: OPENAI_KEY } })}\n`,
    );
    write(NodePath.join(userdata, "keybindings.json"), "[]\n");
    write(NodePath.join(userdata, "secrets", "provider-env-codex-OPENAI_API_KEY.bin"), OPENAI_KEY);
    return { userdata, dbPath };
  });

const query = (dbPath: string, sql: string) => {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};

it.layer(
  Snapshot.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer)),
  ),
)("Snapshot", (it) => {
  it.effect("export then import on a clean home restores threads, settings, memory and bots", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "source");
      const target = NodePath.join(root, "target");
      const bundle = NodePath.join(root, "bundle");
      yield* makeHome(source);

      const exported = yield* runCli(["export", "snapshot", "--base-dir", source, "--out", bundle]);
      assert.include(exported, `Snapshot written to ${bundle}.`);
      assert.include(exported, "Worktrees");

      // Secrets never enter the bundle, in any form.
      const files = NodeFS.readdirSync(bundle, { recursive: true }).map(String);
      assert.isFalse(files.some((file) => file.includes("secrets")));
      for (const file of files) {
        const full = NodePath.join(bundle, file);
        if (!NodeFS.statSync(full).isFile()) continue;
        const bytes = NodeFS.readFileSync(full).toString("latin1");
        assert.notInclude(bytes, OPENAI_KEY, file);
        assert.notInclude(bytes, GITHUB_TOKEN, file);
        assert.notInclude(bytes, "hook-secret", file);
      }
      const manifest = JSON.parse(
        NodeFS.readFileSync(NodePath.join(bundle, "manifest.json"), "utf8"),
      );
      assert.equal(manifest.schema, BUILD_MIGRATION_HEAD);
      assert.isTrue(manifest.notIncluded.some((line: string) => line.startsWith("Worktrees")));
      assert.isTrue(
        manifest.notIncluded.some((line: string) => line.startsWith("Provider-owned data")),
      );
      assert.include(
        NodeFS.readFileSync(NodePath.join(bundle, "README.md"), "utf8"),
        "Not included",
      );

      const restored = yield* runCli([
        "import",
        "snapshot",
        "--source",
        bundle,
        "--base-dir",
        target,
      ]);
      assert.include(restored, `Imported into ${target}.`);

      const dbPath = NodePath.join(target, "userdata", "statev2.sqlite");
      assert.deepEqual(
        query(dbPath, "SELECT title FROM orchestration_v2_projection_threads").map((r) => r.title),
        ["Snapshot thread"],
      );
      assert.deepEqual(
        query(dbPath, "SELECT name FROM bot_profiles").map((r) => r.name),
        ["Helper"],
      );
      assert.deepEqual(
        query(dbPath, "SELECT content FROM memory_items").map((r) => r.content),
        ["deploy token [redacted]"],
      );
      // Redacted JSON stays JSON, and the search index holds only the redacted text.
      assert.deepEqual(
        query(
          dbPath,
          "SELECT json_extract(payload_json, '$.text') AS text FROM orchestration_v2_projection_messages",
        ).map((r) => r.text),
        ["use [redacted] with Authorization: Bearer [redacted]"],
      );
      const matches = (db: string, table: string, term: string) =>
        query(db, `SELECT rowid FROM ${table} WHERE ${table} MATCH '"${term}"'`).length;
      const sourceDb = NodePath.join(source, "userdata", "statev2.sqlite");
      const tokenTail = GITHUB_TOKEN.slice("ghp_".length);
      assert.equal(matches(sourceDb, "orchestration_v2_message_search", "SnapshotTestKey"), 1);
      assert.equal(matches(sourceDb, "memory_fts", tokenTail), 1);
      assert.equal(matches(dbPath, "orchestration_v2_message_search", "SnapshotTestKey"), 0);
      assert.equal(matches(dbPath, "orchestration_v2_message_search", "redacted"), 1);
      assert.equal(matches(dbPath, "memory_fts", tokenTail), 0);
      assert.equal(matches(dbPath, "memory_fts", "redacted"), 1);
      assert.lengthOf(query(dbPath, "SELECT * FROM auth_sessions"), 0);
      assert.lengthOf(query(dbPath, "SELECT * FROM workflow_hooks"), 0);
      const settings = JSON.parse(
        NodeFS.readFileSync(NodePath.join(target, "userdata", "settings.json"), "utf8"),
      );
      assert.deepEqual(settings, {
        enableAssistantStreaming: true,
        providerEnv: { OPENAI_API_KEY: "[redacted]" },
      });
      assert.isTrue(NodeFS.existsSync(NodePath.join(target, "userdata", "keybindings.json")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(target, "userdata", "secrets")));

      // The restored home now has data, so a second import needs --force.
      const again = yield* Effect.flip(
        runCli(["import", "snapshot", "--source", bundle, "--base-dir", target]),
      );
      assert.include(String(again), "--force");
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a snapshot from a newer schema and leaves the target alone", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "source");
      const target = NodePath.join(root, "target");
      const bundle = NodePath.join(root, "bundle");
      const { userdata } = yield* makeHome(source);
      yield* (yield* Snapshot.Snapshot).export({ stateDir: userdata, out: bundle });
      const manifestPath = NodePath.join(bundle, "manifest.json");
      const manifest = JSON.parse(NodeFS.readFileSync(manifestPath, "utf8"));
      write(manifestPath, JSON.stringify({ ...manifest, schema: BUILD_MIGRATION_HEAD + 1 }));

      const failure = yield* Effect.flip(
        runCli(["import", "snapshot", "--source", bundle, "--base-dir", target]),
      );
      assert.include(String(failure), "newer than this build knows");
      assert.isFalse(NodeFS.existsSync(target));
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a folder that is not a snapshot, and an export into a non-empty folder", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "source");
      const { userdata } = yield* makeHome(source);

      const notSnapshot = yield* Effect.flip(
        runCli(["import", "snapshot", "--source", root, "--base-dir", NodePath.join(root, "t")]),
      );
      assert.include(String(notSnapshot), "is not a CMDeck snapshot");
      const unnamed = yield* Effect.flip(
        runCli(["import", "snapshot", "--base-dir", NodePath.join(root, "t")]),
      );
      assert.include(String(unnamed), "--source");

      const failure = yield* Effect.flip(
        (yield* Snapshot.Snapshot).export({ stateDir: userdata, out: source }),
      );
      assert.include(failure.message, "is not empty");
      assert.isTrue(NodeFS.existsSync(NodePath.join(userdata, "statev2.sqlite")));
    }).pipe(Effect.scoped),
  );
});

it("redactStoredText keeps JSON valid where redacting the whole text would break it", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["plain text", "plain text"],
    [`key ${OPENAI_KEY}`, "key [redacted]"],
    [`{"apiKey":"${OPENAI_KEY}"}`, `{"apiKey":"[redacted]"}`],
    // The bare header rule runs to the end of the line, which would eat the closing quote.
    [
      JSON.stringify({ text: "curl -H Authorization: Bearer abcdefghijklmnop", n: 1 }),
      JSON.stringify({ text: "curl -H Authorization: Bearer [redacted]", n: 1 }),
    ],
    [`"${GITHUB_TOKEN}"`, `"[redacted]"`],
  ];
  for (const [input, expected] of cases) {
    assert.equal(Snapshot.redactStoredText(input), expected, input);
  }
});
