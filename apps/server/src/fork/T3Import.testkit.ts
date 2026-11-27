// @effect-diagnostics nodeBuiltinImport:off -- Builds T3 Code data folders with node:sqlite.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { BUILD_MIGRATION_HEAD } from "../persistence/databaseMigrationHead.ts";
import { migrationManifest } from "../persistence/Migrations.ts";

export const write = (file: string, contents: string) => {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, contents);
};

/** A T3 Code data folder at `schema`, whose database stays open in WAL mode until `close`. Like
 * T3 Code's own, the database uses incremental auto_vacuum unless `autoVacuum` says otherwise. */
export const makeSource = (
  base: string,
  schema: number = BUILD_MIGRATION_HEAD,
  autoVacuum: "INCREMENTAL" | "NONE" = "INCREMENTAL",
) => {
  const userdata = NodePath.join(base, "userdata");
  NodeFS.mkdirSync(userdata, { recursive: true });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(userdata, "statev2.sqlite"));
  db.exec(
    `PRAGMA auto_vacuum = ${autoVacuum}; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;`,
  );
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
