// @effect-diagnostics nodeBuiltinImport:off - seeds a database the official build migrated further.
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { SERVICE_LAUNCHER_PROTOCOL, SERVICE_STATE_FILE } from "../cloud/serviceProtocol.ts";
import * as ServerConfig from "../config.ts";
import { BUILD_MIGRATION_HEAD } from "../persistence/databaseMigrationHead.ts";
import * as ForkAlerts from "./ForkAlerts.ts";
import { FORK_RUNTIME_MARKER_FILE } from "./forkRuntimeMarker.ts";

const currentAlerts = Effect.gen(function* () {
  return yield* (yield* ForkAlerts.ForkAlerts).current;
}).pipe(Effect.provide(ForkAlerts.layer));

it.layer(NodeServices.layer)("fork alerts", (it) => {
  it.effect("alerts, without failing, about a newer database and a foreign runtime", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      assert.deepEqual(yield* currentAlerts, []);

      yield* fs.makeDirectory(path.dirname(config.dbPath), { recursive: true });
      const db = new NodeSqlite.DatabaseSync(config.dbPath);
      db.exec("CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, name TEXT)");
      db.prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?), (?, ?)").run(
        BUILD_MIGRATION_HEAD,
        "Known",
        BUILD_MIGRATION_HEAD + 1,
        "OfficialOnly",
      );
      db.close();
      const versionDir = path.join(config.baseDir, "runtime", "versions", "1.2.3");
      yield* fs.makeDirectory(versionDir, { recursive: true });
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.2.3\n");
      yield* fs.writeFileString(
        path.join(config.baseDir, "runtime", SERVICE_STATE_FILE),
        JSON.stringify({ protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "1.2.3" }),
      );

      const alerts = (yield* currentAlerts).join("\n");
      assert.include(alerts, `past this fork's schema (${BUILD_MIGRATION_HEAD + 1}_OfficialOnly)`);
      assert.include(alerts, "scripts/fork/sync-upstream.sh");
      assert.include(alerts, `The background service runs ${versionDir}`);

      yield* fs.writeFileString(path.join(versionDir, FORK_RUNTIME_MARKER_FILE), "");
      assert.notInclude((yield* currentAlerts).join("\n"), "background service");
    }).pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-fork-alerts-test-" })),
    ),
  );
});
