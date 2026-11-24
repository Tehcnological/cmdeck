import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";

import * as T3Import from "../fork/T3Import.ts";
import { baseDirFlag } from "./config.ts";

const fromFlag = Flag.String("from").pipe(
  Flag.withDescription("The official T3 Code data folder to import. Default: ~/.t3."),
  Flag.optional,
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
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
      ? [
          "",
          "CMDeck already has data here. --force moves it to a backup folder before importing.",
        ]
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

export const importFromT3Command = Command.make("import-from-t3", {
  from: fromFlag,
  baseDir: baseDirFlag,
  dryRun: dryRunFlag,
  force: forceFlag,
}).pipe(
  Command.withDescription(
    "Import threads, projects, settings and provider sign-ins from the official T3 Code. Quit CMDeck first.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const importer = yield* T3Import.T3Import;
      const locations = yield* T3Import.resolveImportLocations({
        from: Option.getOrUndefined(flags.from),
        baseDir: Option.getOrUndefined(flags.baseDir),
      });
      const plan = yield* importer.plan(locations);
      yield* Console.log(formatImportPlan(plan));
      if (plan.blockers.length > 0) {
        return yield* new T3Import.T3ImportRefusedError({ reasons: [...plan.blockers] });
      }
      if (flags.dryRun) {
        yield* Console.log("\nDry run: nothing was changed.");
        return;
      }
      yield* Console.log("\nImporting…");
      const result = yield* importer.run({ ...locations, force: flags.force });
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
    }).pipe(Effect.provide(T3Import.layer)),
  ),
);
