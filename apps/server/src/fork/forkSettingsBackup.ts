// Fork-only. Upstream servers decode settings.json with upstream's schema and drop the keys only
// this fork knows when they rewrite it, so the fork mirrors those keys next to settings.json.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as ForkAlerts from "./ForkAlerts.ts";

export const FORK_SETTINGS_BACKUP_FILE = "fork-settings-backup.json";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const FORK_SETTINGS_KEYS = [
  "inferenceServers",
  "textGenerationFallback",
  "textGenerationModelSelectionExplicit",
] as const;
const FORK_PROVIDER_INSTANCE_KEYS = ["inference", "inferenceServerId"] as const;

type JsonObject = Readonly<Record<string, unknown>>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObject = (text: string): JsonObject | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const pick = (record: JsonObject, keys: ReadonlyArray<string>): JsonObject =>
  Object.fromEntries(
    keys.flatMap((key) => (record[key] === undefined ? [] : [[key, record[key]] as const])),
  );

/** The fork-only keys of a settings.json object. An inline credential is left out; a stored one is
 * only the redaction marker and a provider reference names no secret, so both are kept. */
export function forkSettingsSubset(settings: JsonObject): JsonObject {
  const subset: Record<string, unknown> = { ...pick(settings, FORK_SETTINGS_KEYS) };
  if (isJsonObject(subset.inferenceServers)) {
    subset.inferenceServers = Object.fromEntries(
      Object.entries(subset.inferenceServers).map(([id, server]) => {
        if (!isJsonObject(server) || typeof server.apiKey !== "string") return [id, server];
        if (server.apiKey === SECRET_REDACTED) return [id, server];
        return [id, Object.fromEntries(Object.entries(server).filter(([key]) => key !== "apiKey"))];
      }),
    );
  }
  if (isJsonObject(settings.providerInstances)) {
    const instances = Object.entries(settings.providerInstances).flatMap(([id, instance]) => {
      const fields = isJsonObject(instance) ? pick(instance, FORK_PROVIDER_INSTANCE_KEYS) : {};
      return Object.keys(fields).length === 0 ? [] : [[id, fields] as const];
    });
    if (instances.length > 0) subset.providerInstances = Object.fromEntries(instances);
  }
  return subset;
}

/** Puts back the backed-up keys settings.json no longer has; an instance it removed stays removed. */
export function restoreForkSettings(
  settings: JsonObject,
  backup: JsonObject,
): { readonly settings: JsonObject; readonly restored: ReadonlyArray<string> } {
  const next: Record<string, unknown> = { ...settings };
  const restored: string[] = [];
  for (const key of FORK_SETTINGS_KEYS) {
    if (next[key] === undefined && backup[key] !== undefined) {
      next[key] = backup[key];
      restored.push(key);
    }
  }
  if (isJsonObject(backup.providerInstances) && isJsonObject(next.providerInstances)) {
    const instances: Record<string, unknown> = { ...next.providerInstances };
    for (const [id, fields] of Object.entries(backup.providerInstances)) {
      const instance = instances[id];
      if (!isJsonObject(instance) || !isJsonObject(fields)) continue;
      const missing = FORK_PROVIDER_INSTANCE_KEYS.filter(
        (key) => instance[key] === undefined && fields[key] !== undefined,
      );
      if (missing.length === 0) continue;
      instances[id] = { ...instance, ...pick(fields, missing) };
      restored.push(...missing.map((key) => `providerInstances.${id}.${key}`));
    }
    next.providerInstances = instances;
  }
  return { settings: next, restored };
}

const backupPath = (path: Path.Path, settingsPath: string) =>
  path.join(path.dirname(settingsPath), FORK_SETTINGS_BACKUP_FILE);

/** Mirrors the fork-only keys of the settings.json just written, including their removal. */
export const writeForkSettingsBackup = Effect.fn("forkSettingsBackup.write")(
  function* (settingsPath: string, settingsJson: string) {
    const settings = parseJsonObject(settingsJson);
    if (settings === undefined) return;
    const path = yield* Path.Path;
    const contents = yield* encodeJson(forkSettingsSubset(settings));
    yield* writeFileStringAtomically({
      filePath: backupPath(path, settingsPath),
      contents: `${contents}\n`,
    });
  },
  // The settings write already succeeded; a missing backup only loses the next restore.
  Effect.catch((cause) => Effect.logWarning("failed to back up fork-only settings", { cause })),
);

/** settings.json text with lost fork-only keys put back, and which keys came back. */
export const restoreForkSettingsFromBackup = Effect.fn("forkSettingsBackup.restore")(function* (
  settingsPath: string,
  raw: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = parseJsonObject(raw);
  if (settings === undefined) return { raw, restored: [] };
  const backupText = yield* fs
    .readFileString(backupPath(path, settingsPath))
    .pipe(Effect.orElseSucceed(() => ""));
  const backup = parseJsonObject(backupText);
  if (backup === undefined) return { raw, restored: [] };
  const result = restoreForkSettings(settings, backup);
  if (result.restored.length === 0) return { raw, restored: [] };
  const alerts = yield* Effect.serviceOption(ForkAlerts.ForkAlerts);
  const message = `The official T3 Code rewrote settings.json and dropped settings only this fork has (${result.restored.join(", ")}). They were restored from ${FORK_SETTINGS_BACKUP_FILE}; check Settings → Inference.`;
  yield* Option.isSome(alerts)
    ? alerts.value.record(message)
    : Effect.logWarning(message);
  const restoredRaw = yield* encodeJson(result.settings).pipe(Effect.option);
  if (Option.isNone(restoredRaw)) return { raw, restored: [] };
  return { raw: restoredRaw.value, restored: result.restored };
});
