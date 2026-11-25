// @effect-diagnostics nodeBuiltinImport:off -- node:sqlite snapshots the source read-only, and lstat keeps links unresolved while copying.
// Fork-only. Imports an official T3 Code data folder into this build's own, never writing to the source.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import type { ServerConfigIssue } from "@t3tools/contracts";
import {
  APP_HOME_ENV,
  UPSTREAM_HOME_DIR_NAME,
  UPSTREAM_HOME_ENV,
} from "@t3tools/shared/appIdentity";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { DPOP_REPLAY_MARKER_PREFIX } from "../auth/dpop.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath, resolveBaseDir } from "../os-jank.ts";
import { BUILD_MIGRATION_HEAD, recordedMigrations } from "../persistence/databaseMigrationHead.ts";
import { skippedV2Migrations } from "../persistence/Migrations.ts";
import { isServerOwnershipHeld } from "../serverOwnership.ts";

export class T3ImportRefusedError extends Schema.TaggedError<T3ImportRefusedError>()(
  "T3ImportRefusedError",
  { reasons: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Nothing was imported. ${this.reasons.join(" ")}`;
  }
}

export class T3ImportFailedError extends Schema.TaggedError<T3ImportFailedError>()(
  "T3ImportFailedError",
  { stage: Schema.String, path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Import failed while trying to ${this.stage} (${this.path}). The CMDeck data folder was left as it was.`;
  }
}

export type T3ImportError = T3ImportRefusedError | T3ImportFailedError;

export interface ImportItem {
  /** Path relative to the data folder, like `userdata/settings.json`. */
  readonly name: string;
  readonly action: "copy" | "transform" | "skip";
  readonly reason: string;
  readonly bytes: number;
}

export interface ImportPlan {
  readonly source: string;
  readonly target: string;
  /** Highest migration the source database records; undefined when there is none or it is unreadable. */
  readonly sourceSchema: number | undefined;
  readonly buildSchema: number;
  readonly items: ReadonlyArray<ImportItem>;
  /** Bytes the import copies. */
  readonly bytes: number;
  /** The target already holds data, which only `force` moves aside. */
  readonly targetHasData: boolean;
  /** Why the import cannot run at all. */
  readonly blockers: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

export interface ImportResult {
  readonly plan: ImportPlan;
  /** Where the target's previous data was moved. */
  readonly backups: ReadonlyArray<string>;
  /** Rows removed from the copied database, by table. */
  readonly removedRows: Readonly<Record<string, number>>;
}

// Rows tied to the source install's identity: they would let its clients and peers in as CMDeck.
const IDENTITY_TABLES = [
  "auth_sessions",
  "auth_pairing_links",
  "auth_connect_devices",
  "peer_environment_links",
] as const;

/** Secrets that belong to the source install rather than the user: signing keys, its T3 Connect
 * link, tokens other environments issued to it, and replay markers. */
export const isInstallSecret = (name: string): boolean =>
  name.endsWith("-signing-key") ||
  name === "remote-mcp-tokens" ||
  name.startsWith("cloud-") ||
  name.startsWith("peer-link-") ||
  name.startsWith(DPOP_REPLAY_MARKER_PREFIX);

type Rule = { readonly action: ImportItem["action"]; readonly reason: string };

const processState = "process state of the running server";
const rebuilt = "cache; rebuilt when needed";

const STATE_RULES: Readonly<Record<string, Rule>> = {
  "statev2.sqlite": {
    action: "transform",
    reason:
      "threads, projects and history (consistent snapshot; sign-in sessions, pairing links, approved devices and linked environments removed)",
  },
  "statev2.sqlite-wal": { action: "skip", reason: "included in the database snapshot" },
  "statev2.sqlite-shm": { action: "skip", reason: "included in the database snapshot" },
  "statev2.sqlite-journal": { action: "skip", reason: "included in the database snapshot" },
  "state.sqlite": { action: "skip", reason: "old database; statev2.sqlite already holds its data" },
  "state.sqlite-wal": { action: "skip", reason: "old database" },
  "state.sqlite-shm": { action: "skip", reason: "old database" },
  "settings.json": { action: "copy", reason: "settings and provider instances" },
  "fork-settings-backup.json": { action: "copy", reason: "fork-only settings" },
  "keybindings.json": { action: "copy", reason: "keybindings" },
  themes: { action: "copy", reason: "themes" },
  secrets: {
    action: "transform",
    reason: "provider and integration credentials, without the install's own keys",
  },
  attachments: { action: "copy", reason: "files attached to threads" },
  "browser-artifacts": { action: "copy", reason: "browser captures shown in threads" },
  providers: {
    action: "copy",
    reason: "provider sign-ins kept by T3 Code (managed Codex homes, Antigravity profiles)",
  },
  "environment-id": { action: "skip", reason: "CMDeck gets its own environment identity" },
  "server-runtime.json": { action: "skip", reason: processState },
  "server-owner.sqlite": { action: "skip", reason: processState },
  "provider-processes": { action: "skip", reason: processState },
  "antigravity-tmp": { action: "skip", reason: processState },
  logs: { action: "skip", reason: "logs" },
  device: { action: "skip", reason: rebuilt },
  "server-browser": { action: "skip", reason: rebuilt },
  speech: { action: "skip", reason: "downloaded speech models; downloaded again when used" },
  "model-manifest.json": { action: "skip", reason: rebuilt },
  "usage-model-rates.json": { action: "skip", reason: rebuilt },
  "storage-cleanup-leftovers.json": { action: "skip", reason: processState },
};

const BASE_RULES: Readonly<Record<string, Rule>> = {
  workflows: { action: "copy", reason: "workflow files" },
  worktrees: {
    action: "skip",
    reason: "threads keep using their existing worktrees where they are",
  },
  runtime: { action: "skip", reason: "installed T3 Code runtimes and the background service" },
  caches: { action: "skip", reason: rebuilt },
  tools: { action: "skip", reason: "downloaded tools; downloaded again when used" },
  source: { action: "skip", reason: "triage checkouts" },
  "usage-host-id": { action: "skip", reason: "CMDeck gets its own identity" },
};

const UNKNOWN: Rule = { action: "skip", reason: "not recognized by this build" };

// shortcut: the walkers are synchronous, which blocks the event loop; fine for the CLI, move to a worker before an in-server caller.
const entrySize = (at: string): number => {
  const stat = NodeFS.lstatSync(at);
  if (!stat.isDirectory()) return stat.isFile() ? stat.size : 0;
  let total = 0;
  for (const entry of NodeFS.readdirSync(at)) total += entrySize(`${at}/${entry}`);
  return total;
};

const hasFiles = (at: string): boolean => {
  if (!NodeFS.existsSync(at)) return false;
  const stat = NodeFS.lstatSync(at);
  if (!stat.isDirectory()) return true;
  return NodeFS.readdirSync(at).some((entry) => hasFiles(`${at}/${entry}`));
};

// Windows needs a link's kind up front; stat reads only the target's metadata.
const linkType = (at: string, platform: NodeJS.Platform): "dir" | "file" | undefined => {
  if (platform !== "win32") return undefined;
  try {
    return NodeFS.statSync(at).isDirectory() ? "dir" : "file";
  } catch {
    return "file";
  }
};

/** Copies files and directories without following links, so a link out of the folder stays a link. */
const copyTree = (
  from: string,
  to: string,
  platform: NodeJS.Platform,
  include: (name: string) => boolean = () => true,
) => {
  const stat = NodeFS.lstatSync(from);
  if (stat.isDirectory()) {
    NodeFS.mkdirSync(to, { recursive: true, mode: stat.mode & 0o777 });
    for (const entry of NodeFS.readdirSync(from)) {
      if (include(entry)) copyTree(`${from}/${entry}`, `${to}/${entry}`, platform);
    }
  } else if (stat.isSymbolicLink()) {
    NodeFS.symlinkSync(NodeFS.readlinkSync(from), to, linkType(from, platform));
  } else if (stat.isFile()) {
    NodeFS.copyFileSync(from, to, NodeFS.constants.COPYFILE_EXCL);
    NodeFS.chmodSync(to, stat.mode & 0o777);
  }
};

const secretName = (file: string): string | undefined =>
  file.endsWith(".bin") ? file.slice(0, -".bin".length) : undefined;

const includeSecret = (file: string) => {
  const name = secretName(file);
  return name !== undefined && !isInstallSecret(name);
};

const countThreads = (databasePath: string): number | undefined => {
  let db: NodeSqlite.DatabaseSync;
  try {
    db = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  } catch {
    return undefined;
  }
  try {
    const table = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_projection_threads'",
      )
      .get();
    if (table === undefined) return 0;
    return Number(
      db.prepare("SELECT COUNT(*) AS n FROM orchestration_v2_projection_threads").get()?.n ?? 0,
    );
  } catch {
    return undefined;
  } finally {
    db.close();
  }
};

/** A consistent copy of a database another process may be writing; the source is opened read-only. */
const snapshotDatabase = (sourcePath: string, snapshotPath: string) => {
  const db = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true, timeout: 5_000 });
  try {
    db.prepare("VACUUM INTO ?").run(snapshotPath);
  } finally {
    db.close();
  }
  // Setting auto_vacuum on a database that already has it is a write, which the read-only source
  // refuses (T3 Code's own database does). Convert only the copy, and only when it needs it.
  const copy = new NodeSqlite.DatabaseSync(snapshotPath);
  try {
    if (Number(copy.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum) !== 2) {
      copy.exec("PRAGMA auto_vacuum = INCREMENTAL; VACUUM");
    }
  } finally {
    copy.close();
  }
};

const removeIdentityRows = (databasePath: string): Record<string, number> => {
  const db = new NodeSqlite.DatabaseSync(databasePath);
  try {
    const removed: Record<string, number> = {};
    db.exec("BEGIN");
    for (const table of IDENTITY_TABLES) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      if (exists === undefined) continue;
      removed[table] = Number(db.prepare(`DELETE FROM ${table}`).run().changes);
    }
    db.exec("COMMIT");
    return removed;
  } finally {
    db.close();
  }
};

export class T3Import extends Context.Service<
  T3Import,
  {
    /** What `run` would do, without writing anything. Both paths are data folders, like `~/.t3`. */
    readonly plan: (input: {
      readonly source: string;
      readonly target: string;
    }) => Effect.Effect<ImportPlan, T3ImportFailedError>;
    readonly run: (input: {
      readonly source: string;
      readonly target: string;
      /** Move the target's existing data to a timestamped backup instead of refusing. */
      readonly force: boolean;
    }) => Effect.Effect<ImportResult, T3ImportError>;
  }
>()("t3/fork/T3Import") {}

const make = Effect.gen(function* () {
  const path = yield* Path.Path;

  const attempt = <A>(stage: string, at: string, run: () => A) =>
    Effect.try({ try: run, catch: (cause) => new T3ImportFailedError({ stage, path: at, cause }) });
  const derivePaths = (baseDir: string) =>
    ServerConfig.deriveServerPaths(baseDir, undefined).pipe(Effect.provideService(Path.Path, path));
  const removeQuietly = (dir: string) =>
    Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })).pipe(
      Effect.catchDefect(() => Effect.void),
    );

  const plan: T3Import["Service"]["plan"] = Effect.fn("T3Import.plan")(function* ({
    source,
    target,
  }) {
    const sourcePaths = yield* derivePaths(source);
    const targetPaths = yield* derivePaths(target);
    const blockers: string[] = [];
    const notes: string[] = [];

    const items = yield* attempt("read the T3 Code data folder", source, () => {
      const describe = (
        dir: string,
        prefix: string,
        rules: Readonly<Record<string, Rule>>,
      ): ImportItem[] =>
        NodeFS.existsSync(dir)
          ? NodeFS.readdirSync(dir).flatMap((entry): ImportItem[] => {
              if (prefix === "" && entry === "userdata") return [];
              const rule = rules[entry] ?? (entry.startsWith(".") ? undefined : UNKNOWN);
              if (rule === undefined) return [];
              const full = path.join(dir, entry);
              if (entry === "secrets" && prefix !== "") {
                const files = NodeFS.readdirSync(full).filter(
                  (file) => secretName(file) !== undefined,
                );
                const kept = files.filter(includeSecret);
                return [
                  {
                    name: `${prefix}${entry}`,
                    action: rule.action,
                    reason: `${rule.reason}: ${kept.length} copied, ${files.length - kept.length} left out`,
                    bytes: kept.reduce((sum, file) => sum + entrySize(path.join(full, file)), 0),
                  },
                ];
              }
              const bytes =
                entry === "statev2.sqlite"
                  ? entrySize(full) +
                    (NodeFS.existsSync(`${full}-wal`) ? entrySize(`${full}-wal`) : 0)
                  : rule.action === "skip"
                    ? 0
                    : entrySize(full);
              return [{ name: `${prefix}${entry}`, ...rule, bytes }];
            })
          : [];
      return [
        ...describe(sourcePaths.stateDir, "userdata/", STATE_RULES),
        ...describe(source, "", BASE_RULES),
      ];
    });

    const officialHome = path.join(yield* HostProcess.HomeDirectory, UPSTREAM_HOME_DIR_NAME);
    if (path.resolve(source) === path.resolve(target)) {
      blockers.push(
        `The T3 Code folder and the CMDeck folder are the same (${source}). Pass --from with the official T3 Code data folder.`,
      );
    } else if (path.resolve(target) === path.resolve(officialHome)) {
      blockers.push(
        `The CMDeck folder is the official T3 Code data folder (${target}), which CMDeck never writes to. Pass --base-dir with CMDeck's own data folder.`,
      );
    }

    const hasDatabase = NodeFS.existsSync(sourcePaths.dbPath);
    const recorded = hasDatabase ? recordedMigrations(sourcePaths.dbPath) : [];
    const sourceSchema =
      recorded === null || recorded.length === 0
        ? undefined
        : Math.max(...recorded.map(({ id }) => id));
    if (!hasDatabase) {
      blockers.push(
        NodeFS.existsSync(path.join(sourcePaths.stateDir, "state.sqlite"))
          ? `The T3 Code database at ${sourcePaths.stateDir} is from before T3 Code 0.1. Open the official T3 Code once so it upgrades, then import.`
          : `No T3 Code database was found at ${sourcePaths.dbPath}.`,
      );
    } else if (recorded === null) {
      blockers.push(
        `Could not read the T3 Code database at ${sourcePaths.dbPath}. If T3 Code crashed, open and quit it once, then import.`,
      );
    } else if (sourceSchema !== undefined && sourceSchema > BUILD_MIGRATION_HEAD) {
      blockers.push(
        `The T3 Code database uses schema ${sourceSchema}, newer than this CMDeck build knows (${BUILD_MIGRATION_HEAD}). Sync CMDeck with upstream (scripts/fork/sync-upstream.sh) and rebuild, then import.`,
      );
    } else {
      const skipped = skippedV2Migrations(recorded);
      if (skipped.length > 0) {
        blockers.push(
          `The T3 Code database's migration history does not match this CMDeck build (${skipped.join(", ")}). Sync CMDeck with upstream and rebuild, then import.`,
        );
      }
    }

    if (isServerOwnershipHeld(targetPaths.dbPath)) {
      blockers.push(
        `CMDeck is running on ${target}. Quit CMDeck and stop its background service, then import.`,
      );
    }
    if (isServerOwnershipHeld(sourcePaths.dbPath)) {
      notes.push(
        "T3 Code is running. The import copies a consistent snapshot; changes made after it are not imported.",
      );
    }
    if (sourceSchema !== undefined && sourceSchema < BUILD_MIGRATION_HEAD) {
      notes.push(
        `The T3 Code database uses schema ${sourceSchema}; CMDeck upgrades the copy to ${BUILD_MIGRATION_HEAD} when it next starts.`,
      );
    }

    const targetHasData = yield* attempt("read the CMDeck data folder", target, () =>
      hasFiles(targetPaths.stateDir) ? true : hasFiles(targetPaths.workflowsDir),
    );

    return {
      source,
      target,
      sourceSchema,
      buildSchema: BUILD_MIGRATION_HEAD,
      items,
      bytes: items.reduce((sum, item) => sum + (item.action === "skip" ? 0 : item.bytes), 0),
      targetHasData,
      blockers,
      notes,
    };
  });

  const run: T3Import["Service"]["run"] = Effect.fn("T3Import.run")(function* ({
    source,
    target,
    force,
  }) {
    const planned = yield* plan({ source, target });
    if (planned.blockers.length > 0) {
      return yield* new T3ImportRefusedError({ reasons: [...planned.blockers] });
    }
    if (planned.targetHasData && !force) {
      return yield* new T3ImportRefusedError({
        reasons: [
          `CMDeck already has data in ${target}. Run again with --force to move it to a backup folder and import.`,
        ],
      });
    }

    const sourcePaths = yield* derivePaths(source);
    const targetPaths = yield* derivePaths(target);
    const now = yield* Clock.currentTimeMillis;
    const platform = yield* HostProcess.Platform;
    const stamp = DateTime.formatIso(DateTime.makeUnsafe(now)).replace(/[:.]/g, "-");
    const staging = path.join(target, `.userdata-import-${process.pid}-${stamp}`);
    const stagedWorkflows = path.join(staging, ".workflows");

    const copied = planned.items.filter((item) => item.action !== "skip");
    const stage = Effect.gen(function* () {
      yield* attempt("create a staging folder", staging, () =>
        NodeFS.mkdirSync(staging, { recursive: true, mode: 0o700 }),
      );
      yield* attempt("snapshot the database", sourcePaths.dbPath, () =>
        snapshotDatabase(sourcePaths.dbPath, path.join(staging, "statev2.sqlite")),
      );
      const removedRows = yield* attempt(
        "remove sessions and pairings from the copy",
        staging,
        () => removeIdentityRows(path.join(staging, "statev2.sqlite")),
      );
      for (const item of copied) {
        if (item.name === "userdata/statev2.sqlite") continue;
        const from = path.join(source, item.name);
        const to = item.name.startsWith("userdata/")
          ? path.join(staging, item.name.slice("userdata/".length))
          : stagedWorkflows;
        yield* attempt(`copy ${item.name}`, from, () =>
          copyTree(
            from,
            to,
            platform,
            item.name === "userdata/secrets" ? includeSecret : undefined,
          ),
        );
      }
      return removedRows;
    });

    // The old data moves aside only once the copy is complete, and comes back if the swap fails.
    const swap = Effect.gen(function* () {
      if (isServerOwnershipHeld(targetPaths.dbPath)) {
        return yield* new T3ImportRefusedError({
          reasons: [`CMDeck started on ${target} during the import. Quit it, then import again.`],
        });
      }
      const backups: string[] = [];
      const moveAside = (dir: string) =>
        attempt("move the existing CMDeck data aside", dir, () => {
          if (!NodeFS.existsSync(dir)) return;
          if (!hasFiles(dir)) {
            NodeFS.rmSync(dir, { recursive: true });
            return;
          }
          const backup = `${dir}.backup-${stamp}`;
          NodeFS.renameSync(dir, backup);
          backups.push(backup);
        });
      const stagedWorkflowsExist = NodeFS.existsSync(stagedWorkflows);
      const undo = Effect.sync(() => {
        if (
          stagedWorkflowsExist &&
          NodeFS.existsSync(staging) &&
          !NodeFS.existsSync(stagedWorkflows)
        ) {
          NodeFS.renameSync(targetPaths.workflowsDir, stagedWorkflows);
        }
        for (const backup of backups) {
          const original = backup.slice(0, -`.backup-${stamp}`.length);
          if (!NodeFS.existsSync(original)) NodeFS.renameSync(backup, original);
        }
      }).pipe(Effect.catchDefect(() => Effect.void));
      yield* Effect.gen(function* () {
        yield* moveAside(targetPaths.stateDir);
        yield* moveAside(targetPaths.workflowsDir);
        yield* attempt("publish the imported data", targetPaths.stateDir, () => {
          if (stagedWorkflowsExist) NodeFS.renameSync(stagedWorkflows, targetPaths.workflowsDir);
          NodeFS.renameSync(staging, targetPaths.stateDir);
        });
      }).pipe(Effect.onError(() => undo));
      return backups;
    });

    const removedRows = yield* stage.pipe(Effect.onError(() => removeQuietly(staging)));
    const backups = yield* swap.pipe(Effect.onError(() => removeQuietly(staging)));
    return { plan: planned, backups, removedRows };
  });

  return T3Import.of({ plan, run });
});

export const layer = Layer.effect(T3Import, make);

/** Where an import reads from and writes to.
 * shortcut: the source is `~/.t3` and the target this build's base dir; repoint both at the
 * data-dir constants once CMDeck's own home (`~/.cmdeck`) lands. */
export const resolveImportLocations = Effect.fn("T3Import.resolveImportLocations")(
  function* (input: { readonly from: string | undefined; readonly baseDir: string | undefined }) {
    const path = yield* Path.Path;
    const envHome = yield* Config.String(APP_HOME_ENV).pipe(
      Config.orElse(() => Config.String(UPSTREAM_HOME_ENV)),
      Config.option,
    );
    const target = yield* resolveBaseDir(input.baseDir ?? Option.getOrUndefined(envHome));
    const rawSource =
      input.from === undefined
        ? path.join(yield* HostProcess.HomeDirectory, UPSTREAM_HOME_DIR_NAME)
        : path.resolve(yield* expandHomePath(input.from.trim()));
    // `--from ~/.t3/userdata` names the state folder; the import wants the folder holding it.
    const source =
      path.basename(rawSource) === "userdata" &&
      NodeFS.existsSync(path.join(rawSource, "statev2.sqlite"))
        ? path.dirname(rawSource)
        : rawSource;
    return { source, target };
  },
);

/** The import offer the app shows while this build's own database has no threads. */
export const importOfferIssues = Effect.fn("T3Import.importOfferIssues")(function* () {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const source = path.join(yield* HostProcess.HomeDirectory, UPSTREAM_HOME_DIR_NAME);
  const sourceDb = (yield* ServerConfig.deriveServerPaths(source, undefined)).dbPath;
  if (
    path.resolve(source) === path.resolve(config.baseDir) ||
    !NodeFS.existsSync(sourceDb) ||
    countThreads(config.dbPath) !== 0
  ) {
    return [];
  }
  const issue: ServerConfigIssue = {
    kind: "fork.import-available",
    message: `CMDeck can import the threads, projects and settings T3 Code keeps in ${source}. Quit CMDeck, run the command (add --dry-run first to see what it copies), then start CMDeck again. --force moves what CMDeck created on its first start to a backup folder. Devices paired with T3 Code, including the T3 Code iPhone app, must pair with CMDeck again.`,
    // Starting CMDeck already wrote its data folder, so without --force the import always refuses.
    command: `cmdeck import-from-t3 --base-dir "${config.baseDir}" --force`,
  };
  return [issue];
});
