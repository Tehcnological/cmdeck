import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/cli";

import * as ServerConfig from "../config.ts";
import * as AuditLog from "../fork/audit/AuditLog.ts";
import * as Importer from "../fork/import/Importer.ts";
import type * as T3Import from "../fork/T3Import.ts";
import { T3ImportRefusedError } from "../fork/T3Import.ts";
import { baseDirFlag } from "./config.ts";

const sourceArgument = Argument.String("source").pipe(
  Argument.withDescription(
    "What to import from. Sources: t3 (the official T3 Code), snapshot (a folder `cmdeck export snapshot` wrote; name it with --source).",
  ),
  Argument.withDefault("t3"),
);

const sourceDirFlag = Flag.String("source").pipe(
  Flag.withAlias("from"),
  Flag.withDescription("The data folder to import from. Default: the source's own, like ~/.t3."),
  Flag.optional,
);

const planFlag = Flag.Boolean("plan").pipe(
  Flag.withAlias("dry-run"),
  Flag.withDescription("Show what would be imported, and change nothing."),
  Flag.withDefault(false),
);

const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Import even though CMDeck already has data; that data moves to a timestamped backup folder.",
  ),
  Flag.withDefault(false),
);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const ACTION_LABELS = { copy: "copy", transform: "copy*", skip: "skip" } as const;

export const formatImportPlan = (plan: T3Import.ImportPlan): string =>
  [
    `From: ${plan.source}`,
    `To:   ${plan.target}`,
    `Database schema: ${plan.sourceSchema ?? "unknown"} (this build: ${plan.buildSchema})`,
    "",
    ...plan.items.map(
      (item) =>
        `  ${ACTION_LABELS[item.action].padEnd(6)} ${item.name.padEnd(34)} ${
          item.action === "skip" ? "" : `${formatBytes(item.bytes).padStart(9)}  `
        }${item.reason}`,
    ),
    "",
    "  copy* = copied with changes; see the reason.",
    `Total to copy: ${formatBytes(plan.bytes)}`,
    ...(plan.targetHasData
      ? ["", "CMDeck already has data here. --force moves it to a backup folder before importing."]
      : []),
    ...plan.notes.map((note) => `Note: ${note}`),
    ...plan.blockers.map((blocker) => `Cannot import: ${blocker}`),
  ].join("\n");

const AFTER_IMPORT = [
  "Start CMDeck to finish: it upgrades the imported database if needed.",
  "CMDeck has a new identity, so every device must pair again, including the official T3 Code",
  "iPhone app (add CMDeck as a separate environment). Provider sign-ins kept by the provider CLIs",
  "themselves carry over; any that were left out above must be entered again.",
];

// `import-from-t3` predates other sources; the alias keeps its flags (`--from`, `--dry-run`) working.
export const importCommand = Command.make("import", {
  source: sourceArgument,
  sourceDir: sourceDirFlag,
  baseDir: baseDirFlag,
  plan: planFlag,
  force: forceFlag,
}).pipe(
  Command.withAlias("import-from-t3"),
  Command.withDescription(
    "Import threads, projects, settings and provider sign-ins from another app, like the official T3 Code. Quit CMDeck first.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const source = yield* (yield* Importer.Importer).source(flags.source);
      const locations = yield* Importer.resolveImportLocations({
        source,
        from: Option.getOrUndefined(flags.sourceDir),
        baseDir: Option.getOrUndefined(flags.baseDir),
      });
      const plan = yield* source.plan(locations);
      yield* Console.log(formatImportPlan(plan));
      if (plan.blockers.length > 0) {
        return yield* new T3ImportRefusedError({ reasons: [...plan.blockers] });
      }
      if (flags.plan) {
        yield* Console.log("\nDry run: nothing was changed.");
        return;
      }
      yield* Console.log("\nImporting…");
      const result = yield* source.run({ ...locations, force: flags.force });
      // The chain starts again in the imported database; the previous one moved with the backup.
      const { dbPath } = yield* ServerConfig.deriveServerPaths(locations.target, undefined);
      const fs = yield* FileSystem.FileSystem;
      if (yield* fs.exists(dbPath).pipe(Effect.orElseSucceed(() => false))) {
        yield* AuditLog.appendToDatabase(dbPath, {
          kind: "import.run",
          actor: "cli",
          subject: flags.source,
          detail: {
            from: locations.source,
            items: plan.items.filter((item) => item.action !== "skip").length,
            backups: result.backups.length,
          },
        });
      }
      const removed = Object.entries(result.removedRows)
        .filter(([, count]) => count > 0)
        .map(([table, count]) => `${count} ${table}`);
      yield* Console.log(
        [
          `Imported into ${locations.target}.`,
          ...result.backups.map((backup) => `CMDeck's previous data was moved to ${backup}.`),
          removed.length > 0
            ? `Removed from the copy: ${removed.join(", ")}.`
            : "No sessions or pairings needed removing.",
          "",
          ...AFTER_IMPORT,
        ].join("\n"),
      );
    }).pipe(Effect.provide(Importer.layer)),
  ),
);
