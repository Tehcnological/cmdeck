import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { InferenceServerId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as ForkAlerts from "./ForkAlerts.ts";
import {
  FORK_SETTINGS_BACKUP_FILE,
  forkSettingsSubset,
  restoreForkSettings,
} from "./forkSettingsBackup.ts";

// Fresh per provide, so each use is one server run over the same home.
const layerServerRun = Layer.fresh(
  ServerSettingsModule.layer.pipe(
    Layer.provide(ManagedPolicy.layerTest()),
    Layer.provideMerge(ForkAlerts.layer),
  ),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("fork settings backup", (it) => {
  it.effect("restores inference servers an upstream server dropped from settings.json", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const rtx = InferenceServerId.make("rtx");
      yield* Effect.gen(function* () {
        const service = yield* ServerSettingsModule.ServerSettingsService;
        yield* service.updateSettings({
          inferenceServers: {
            [rtx]: { baseUrl: "http://localhost:8888/v1", apiKey: "rtx-secret", enabled: true },
          },
          textGenerationFallback: "local",
        });
      }).pipe(Effect.provide(layerServerRun));

      const backupPath = path.join(path.dirname(config.settingsPath), FORK_SETTINGS_BACKUP_FILE);
      const backup = yield* fs.readFileString(backupPath);
      assert.include(backup, "http://localhost:8888/v1");
      assert.notInclude(backup, "rtx-secret");

      // What an upstream server writes back: everything it decodes, minus the fork's keys.
      const upstream: Record<string, unknown> = JSON.parse(
        yield* fs.readFileString(config.settingsPath),
      );
      delete upstream.inferenceServers;
      delete upstream.textGenerationFallback;
      yield* fs.writeFileString(config.settingsPath, `${JSON.stringify(upstream)}\n`);

      yield* Effect.gen(function* () {
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const settings = yield* service.getSettings;
        assert.equal(settings.inferenceServers[rtx]?.baseUrl, "http://localhost:8888/v1");
        assert.equal(settings.inferenceServers[rtx]?.apiKey, "rtx-secret");
        assert.equal(settings.textGenerationFallback, "local");
        const alerts = yield* (yield* ForkAlerts.ForkAlerts).current;
        assert.equal(alerts.length, 1);
        assert.include(alerts.join(" "), "(inferenceServers, textGenerationFallback)");
      }).pipe(Effect.provide(layerServerRun));
      assert.include(yield* fs.readFileString(config.settingsPath), "http://localhost:8888/v1");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(ServerSecretStore.layer, SqlitePersistence.layerMemory).pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3code-fork-settings-test-" }),
          ),
        ),
      ),
    ),
  );
});

it("keeps inline credentials out of the backup and deleted instances deleted", () => {
  const backup = forkSettingsSubset({
    theme: "dark",
    inferenceServers: { rtx: { baseUrl: "http://a/v1", apiKey: "inline-secret" } },
    providerInstances: {
      pi: { driver: "pi", inferenceServerId: "rtx" },
      gone: { driver: "pi", inference: "local" },
      plain: { driver: "codex" },
    },
  });
  assert.deepEqual(backup, {
    inferenceServers: { rtx: { baseUrl: "http://a/v1" } },
    providerInstances: { pi: { inferenceServerId: "rtx" }, gone: { inference: "local" } },
  });

  const result = restoreForkSettings(
    { providerInstances: { pi: { driver: "pi" }, plain: { driver: "codex" } } },
    backup,
  );
  assert.deepEqual(result.restored, ["inferenceServers", "providerInstances.pi.inferenceServerId"]);
  assert.deepEqual(result.settings.providerInstances, {
    pi: { driver: "pi", inferenceServerId: "rtx" },
    plain: { driver: "codex" },
  });
});
