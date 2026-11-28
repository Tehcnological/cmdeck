// @effect-diagnostics nodeBuiltinImport:off -- node:sqlite copies and scrubs the database file; node:fs writes the bundle.
// Fork-only. `cmdeck export snapshot` writes a folder that `cmdeck import snapshot --source` restores.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

import { redactSecrets } from "@t3tools/shared/redaction";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import packageJson from "../../../package.json" with { type: "json" };
import {
  BUILD_MIGRATION_HEAD,
  recordedMigrations,
} from "../../persistence/databaseMigrationHead.ts";
import * as T3Import from "../T3Import.ts";
import type { ImportSource } from "./Importer.ts";

const MANIFEST_FILE = "manifest.json";
const README_FILE = "README.md";
const FORMAT = "cmdeck-snapshot-1";

const INCLUDED = [
  "userdata/statev2.sqlite: threads, projects, history, memory, bots, scheduled tasks and the rest of CMDeck's database, with sign-ins and secrets removed and credential-like text redacted",
  "userdata/settings.json: settings, with credential-like text redacted",
  "userdata/keybindings.json: keybindings",
];

const NOT_INCLUDED = [
  "Secrets: the encrypted secret store (provider and integration credentials, bot tokens), webhook tokens and workflow hook tokens. Enter them again after importing; webhooks and workflow hooks get new addresses.",
  "Sign-in sessions, pairing links, approved devices and linked environments. Pair every device again.",
  "Worktrees and project folders. Threads point at them where they are on the machine that made the snapshot.",
  "Provider-owned data: Claude, Codex and other providers' own session files, sign-ins and homes.",
  "Attachments, browser captures, custom themes, workflow files, logs and caches.",
];

const SnapshotManifest = Schema.Struct({
  format: Schema.Literal(FORMAT),
  appVersion: Schema.String,
  /** The highest upstream migration the database records; a build older than this cannot import it. */
  schema: Schema.Number,
  createdAt: Schema.String,
  included: Schema.Array(Schema.String),
  notIncluded: Schema.Array(Schema.String),
});
export type SnapshotManifest = typeof SnapshotManifest.Type;
const isManifest = Schema.is(SnapshotManifest);

export class SnapshotExportError extends Schema.TaggedError<SnapshotExportError>()(
  "SnapshotExportError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

// Removed outright: they let the snapshot's holder in as this install, or call its hooks.
const REMOVED_TABLES = [...T3Import.IDENTITY_TABLES, "auth_pairing_requests", "workflow_hooks"];
// Hash-chained, and already redacted when written.
const UNREDACTED_TABLES = new Set(["audit_events"]);
// Adapted from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// src/kiro_crew/snapshot_redact.py _FTS_INDEX_SUFFIXES (Apache-2.0).
const FTS_INDEX_SUFFIXES = ["data", "idx", "docsize", "config"];

// A string is redacted with its property name, so label-based patterns (`"apiKey": ...`) still match.
const redactProperty = (key: string, item: unknown): unknown => {
  if (typeof item !== "string") return redactLeaves(item);
  try {
    const labelled = JSON.parse(redactSecrets(JSON.stringify({ [key]: item }))) as Record<
      string,
      unknown
    >;
    if (typeof labelled[key] === "string") return redactSecrets(labelled[key]);
  } catch {}
  return redactSecrets(item);
};

const redactLeaves = (value: unknown): unknown =>
  typeof value === "string"
    ? redactSecrets(value)
    : Array.isArray(value)
      ? value.map(redactLeaves)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, redactProperty(key, item)]),
          )
        : value;

/** `redactSecrets`, except that JSON stays valid JSON: when redacting the whole text breaks it,
 * only its strings are redacted (a labelled value then needs its own pattern to match). */
export const redactStoredText = (text: string): string => {
  const redacted = redactSecrets(text);
  if (redacted === text || !/^\s*[[{"]/.test(text)) return redacted;
  try {
    JSON.parse(redacted);
    return redacted;
  } catch {
    try {
      return JSON.stringify(redactLeaves(JSON.parse(text)));
    } catch {
      return redacted;
    }
  }
};

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Strips the copy of what must not leave the machine, then rewrites it so freed pages keep nothing. */
const scrubDatabase = (dbPath: string): Record<string, number> => {
  const db = new NodeSqlite.DatabaseSync(dbPath, { enableForeignKeyConstraints: false });
  try {
    // An UPDATE's WHERE and SET redact the same value; the cache spares the second pass.
    let lastInput: string | undefined;
    let lastOutput = "";
    db.function("cmdeck_redact", { deterministic: true }, (value) => {
      if (typeof value !== "string") return value;
      if (value !== lastInput) {
        lastInput = value;
        lastOutput = redactStoredText(value);
      }
      return lastOutput;
    });
    const tables = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => ({ name: String(row.name), sql: String(row.sql ?? "") }));
    const names = new Set(tables.map((table) => table.name));
    const virtual = tables
      .filter((table) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql))
      .map((table) => table.name);
    const columnsOf = (table: string) =>
      db
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(table)
        .map((row) => String(row.name));

    const removed: Record<string, number> = {};
    db.exec("BEGIN");
    for (const table of REMOVED_TABLES) {
      if (names.has(table)) {
        removed[table] = Number(db.prepare(`DELETE FROM ${quote(table)}`).run().changes);
      }
    }
    if (names.has("scheduled_tasks") && columnsOf("scheduled_tasks").includes("webhook_token")) {
      db.exec("UPDATE scheduled_tasks SET webhook_token = NULL, webhook_secret = NULL");
    }
    // A full-text table's index shadow tables are rebuilt from the redacted rows below; its
    // `_content` table holds plain text, so it is redacted like any other.
    const indexTables = new Set(
      virtual.flatMap((v) => [v, ...FTS_INDEX_SUFFIXES.map((suffix) => `${v}_${suffix}`)]),
    );
    for (const { name } of tables) {
      if (UNREDACTED_TABLES.has(name) || indexTables.has(name)) continue;
      for (const column of columnsOf(name)) {
        const c = quote(column);
        db.exec(
          `UPDATE ${quote(name)} SET ${c} = cmdeck_redact(${c}) WHERE typeof(${c}) = 'text' AND cmdeck_redact(${c}) IS NOT ${c}`,
        );
      }
    }
    for (const table of tables) {
      if (!virtual.includes(table.name) || !/USING\s+fts5/i.test(table.sql)) continue;
      const fts = quote(table.name);
      try {
        db.exec(`INSERT INTO ${fts}(${fts}) VALUES('rebuild')`);
      } catch {
        // A contentless index cannot rebuild; merging its segments drops the replaced entries.
        db.exec(`INSERT INTO ${fts}(${fts}) VALUES('optimize')`);
      }
    }
    db.exec("COMMIT");
    db.exec("VACUUM");
    return removed;
  } finally {
    db.close();
  }
};

const manifestText = (manifest: SnapshotManifest) => `${JSON.stringify(manifest, null, 2)}\n`;

const readme = (manifest: SnapshotManifest) =>
  [
    "# CMDeck snapshot",
    "",
    `Made by CMDeck ${manifest.appVersion} (database schema ${manifest.schema}) at ${manifest.createdAt}.`,
    "",
    "Restore it with CMDeck stopped:",
    "",
    "    cmdeck import snapshot --source <this folder> --plan",
    "    cmdeck import snapshot --source <this folder>",
    "",
    "A CMDeck whose database schema is older than this snapshot's refuses it. Text that looked like a credential was replaced with [redacted]; this is best effort, so keep the folder private.",
    "",
    "## Included",
    "",
    ...manifest.included.map((line) => `- ${line}`),
    "",
    "## Not included",
    "",
    ...manifest.notIncluded.map((line) => `- ${line}`),
    "",
  ].join("\n");

export interface SnapshotExportResult {
  readonly path: string;
  readonly manifest: SnapshotManifest;
  /** Rows removed from the copy, by table. */
  readonly removedRows: Readonly<Record<string, number>>;
}

export class Snapshot extends Context.Service<
  Snapshot,
  {
    /** Writes a snapshot of the data folder `stateDir` (like `~/.cmdeck/userdata`) into `out`, an
     * empty or new folder; by default `snapshots/snapshot-<time>` beside `stateDir`. */
    readonly export: (input: {
      readonly stateDir: string;
      readonly out: string | undefined;
    }) => Effect.Effect<SnapshotExportResult, SnapshotExportError>;
  }
>()("t3/fork/import/Snapshot") {}

const make = Effect.gen(function* () {
  const path = yield* Path.Path;

  // shortcut: synchronous SQLite and file work blocks the event loop for the length of the copy;
  // fine for a rare, explicit export, move to a worker if large databases stall clients.
  const exportSnapshot: Snapshot["Service"]["export"] = Effect.fn("Snapshot.export")(function* ({
    stateDir,
    out,
  }) {
    const now = yield* Clock.currentTimeMillis;
    const createdAt = DateTime.formatIso(DateTime.makeUnsafe(now));
    const target =
      out ??
      path.join(path.dirname(stateDir), "snapshots", `snapshot-${createdAt.replace(/[:.]/g, "-")}`);
    const dbPath = path.join(stateDir, "statev2.sqlite");
    const recorded = NodeFS.existsSync(dbPath) ? recordedMigrations(dbPath) : null;
    if (recorded === null || recorded.length === 0) {
      return yield* new SnapshotExportError({
        detail: `There is no readable CMDeck database at ${dbPath}.`,
      });
    }
    if (NodeFS.existsSync(target) && NodeFS.readdirSync(target).length > 0) {
      return yield* new SnapshotExportError({
        detail: `${target} is not empty. Name a new or empty folder.`,
      });
    }
    const manifest: SnapshotManifest = {
      format: FORMAT,
      appVersion: packageJson.version,
      schema: Math.max(...recorded.map(({ id }) => id)),
      createdAt,
      included: INCLUDED,
      notIncluded: NOT_INCLUDED,
    };

    const removedRows = yield* Effect.try({
      try: () => {
        const userdata = path.join(target, "userdata");
        NodeFS.mkdirSync(userdata, { recursive: true, mode: 0o700 });
        const copy = path.join(userdata, "statev2.sqlite");
        // VACUUM INTO reads one consistent snapshot, so a running server can keep writing.
        const source = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 });
        try {
          source.prepare("VACUUM INTO ?").run(copy);
        } finally {
          source.close();
        }
        const removed = scrubDatabase(copy);
        const settings = path.join(stateDir, "settings.json");
        if (NodeFS.existsSync(settings)) {
          NodeFS.writeFileSync(
            path.join(userdata, "settings.json"),
            redactStoredText(NodeFS.readFileSync(settings, "utf8")),
          );
        }
        const keybindings = path.join(stateDir, "keybindings.json");
        if (NodeFS.existsSync(keybindings)) {
          NodeFS.copyFileSync(keybindings, path.join(userdata, "keybindings.json"));
        }
        NodeFS.writeFileSync(path.join(target, MANIFEST_FILE), manifestText(manifest));
        NodeFS.writeFileSync(path.join(target, README_FILE), readme(manifest));
        return removed;
      },
      catch: (cause) =>
        new SnapshotExportError({
          detail: `Could not write the snapshot to ${target}: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => NodeFS.rmSync(target, { recursive: true, force: true })).pipe(
          Effect.catchDefect(() => Effect.void),
        ),
      ),
    );
    return { path: target, manifest, removedRows };
  });

  return Snapshot.of({ export: exportSnapshot });
});

export const layer = Layer.effect(Snapshot, make);

const readManifest = (bundle: string): SnapshotManifest | string => {
  if (bundle === "") return "Name the snapshot folder with --source.";
  const file = `${bundle}/${MANIFEST_FILE}`;
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    if (isManifest(parsed)) return parsed;
  } catch {
    // Reported below with the same message as a manifest of the wrong shape.
  }
  return `${bundle} is not a CMDeck snapshot: ${file} is missing or not one this build reads.`;
};

/** The `snapshot` import source. A snapshot is laid out like a data folder, so T3Import restores it. */
export const importSource = (t3: T3Import.T3Import["Service"]): ImportSource => {
  const plan: ImportSource["plan"] = Effect.fn("Snapshot.importPlan")(function* (input) {
    const manifest = readManifest(input.source);
    const refused = (reason: string): T3Import.ImportPlan => ({
      ...input,
      sourceSchema: typeof manifest === "string" ? undefined : manifest.schema,
      buildSchema: BUILD_MIGRATION_HEAD,
      items: [],
      bytes: 0,
      targetHasData: false,
      blockers: [reason],
      notes: [],
    });
    if (typeof manifest === "string") return refused(manifest);
    if (manifest.schema > BUILD_MIGRATION_HEAD) {
      return refused(
        `This snapshot was made by CMDeck ${manifest.appVersion} with database schema ${manifest.schema}, newer than this build knows (${BUILD_MIGRATION_HEAD}). Update CMDeck, then import.`,
      );
    }
    const planned = yield* t3.plan(input);
    return {
      ...planned,
      items: planned.items.filter(
        (item) => item.name !== MANIFEST_FILE && item.name !== README_FILE,
      ),
    };
  });
  return {
    locate: (dir) => Effect.succeed(dir ?? ""),
    plan,
    run: Effect.fn("Snapshot.importRun")(function* (input) {
      const planned = yield* plan(input);
      if (planned.blockers.length > 0) {
        return yield* new T3Import.T3ImportRefusedError({ reasons: [...planned.blockers] });
      }
      return yield* t3.run(input);
    }),
  };
};
