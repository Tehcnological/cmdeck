// Fork-only. This fork shares its T3 home with the official T3 Code (see
// docs/operations/fork-upstream-sync.md); these alerts say when the official build used it.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type { ServerConfigIssue } from "@t3tools/contracts";

import { parseServiceState, SERVICE_STATE_FILE } from "../cloud/serviceProtocol.ts";
import * as ServerConfig from "../config.ts";
import { BUILD_MIGRATION_HEAD, recordedMigrations } from "../persistence/databaseMigrationHead.ts";
import { FORK_RUNTIME_MARKER_FILE, unmarkedActiveRuntimeAlert } from "./forkRuntimeMarker.ts";

const databaseNewerThanForkAlert =(migrations: ReadonlyArray<string>) =>
  `The official T3 Code upgraded this database past this fork's schema (${migrations.join(", ")}). This fork still started, but some features may misbehave until you sync it: run \`scripts/fork/sync-upstream.sh\`, then rebuild.`;

export class ForkAlerts extends Context.Service<
  ForkAlerts,
  {
    /** Alerts raised since this server started, oldest first. */
    readonly current: Effect.Effect<ReadonlyArray<string>>;
    readonly record: (message: string) => Effect.Effect<void>;
  }
>()("t3/fork/ForkAlerts") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const alerts = yield* Ref.make<ReadonlyArray<string>>([]);

  const record = Effect.fn("ForkAlerts.record")(function* (message: string) {
    yield* Effect.logWarning("The official T3 Code used this fork's data folder").pipe(
      Effect.annotateLogs({ alert: message }),
    );
    yield* Ref.update(alerts, (current) =>
      current.includes(message) ? current : [...current, message],
    );
  });

  // Upstream keeps starting on a database a newer build migrated; the fork does too, but says so.
  const newer = (recordedMigrations(config.dbPath) ?? []).filter(
    ({ id }) => id > BUILD_MIGRATION_HEAD,
  );
  if (newer.length > 0) {
    yield* record(databaseNewerThanForkAlert(newer.map(({ id, name }) => `${id}_${name}`)));
  }

  const runtimeDir = path.join(config.baseDir, "runtime");
  const serviceState = yield* fs
    .readFileString(path.join(runtimeDir, SERVICE_STATE_FILE))
    .pipe(Effect.map(parseServiceState), Effect.orElseSucceed(() => undefined));
  if (serviceState !== undefined) {
    const versionDir = path.join(runtimeDir, "versions", serviceState.activeVersion);
    const [complete, forkInstalled] = yield* Effect.all([
      fs.exists(path.join(versionDir, ".install-complete")),
      fs.exists(path.join(versionDir, FORK_RUNTIME_MARKER_FILE)),
    ]).pipe(Effect.orElseSucceed(() => [false, true] as const));
    if (complete && !forkInstalled) yield* record(unmarkedActiveRuntimeAlert(versionDir));
  }

  return ForkAlerts.of({ current: Ref.get(alerts), record });
});

export const layer = Layer.effect(ForkAlerts, make);

/** As server config issues, which clients built from upstream contracts ignore. */
export const configIssues = (alerts: Option.Option<ForkAlerts["Service"]>) =>
  Option.isNone(alerts)
    ? Effect.succeed<ReadonlyArray<ServerConfigIssue>>([])
    : alerts.value.current.pipe(
        Effect.map((messages) =>
          messages.map((message): ServerConfigIssue => ({ kind: "fork.shared-data", message })),
        ),
      );
