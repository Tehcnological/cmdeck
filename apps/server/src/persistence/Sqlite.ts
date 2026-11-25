import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { hasPendingMigrations, runMigrations } from "./Migrations.ts";
import { initializeV2Database } from "./initializeV2Database.ts";
import * as ServerConfig from "../config.ts";
import * as ServerOwnership from "../serverOwnership.ts";

const WAL_SIZE_LIMIT_BYTES = 128 * 1024 * 1024;
const DEFAULT_MMAP_BYTES = 256 * 1024 * 1024;
// mmap turns an I/O error on a network or cloud-synced file into a crash, or corruption when another host writes it.
// shortcut: only path names are checked; NFS/SMB mounted at an ordinary path need T3CODE_SQLITE_MMAP_BYTES=0.
const NETWORK_OR_SYNCED_PATH =
  /^(?:\\\\|\/\/)|[\\/](?:onedrive|dropbox|icloud ?drive|mobile documents|google ?drive|box)(?:[\\/]| - |$)/i;

/** `T3CODE_SQLITE_MMAP_BYTES` wins (0 disables); otherwise 256 MiB, or 0 on a network or synced path. */
export const readMmapBytes = (dbPath: string) =>
  Config.option(Config.Int("T3CODE_SQLITE_MMAP_BYTES")).pipe(
    Effect.map(
      Option.match({
        onSome: (bytes) => Math.max(0, bytes),
        onNone: () => (NETWORK_OR_SYNCED_PATH.test(dbPath) ? 0 : DEFAULT_MMAP_BYTES),
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("T3CODE_SQLITE_MMAP_BYTES is not a whole number; SQLite mmap stays off.", {
        cause,
      }).pipe(Effect.as(0)),
    ),
  );

export class ServerOwnsDatabaseError extends Schema.TaggedError<ServerOwnsDatabaseError>()(
  "ServerOwnsDatabaseError",
  { stateDir: Schema.String },
) {
  override get message(): string {
    return `Another CMDeck process, usually a running server, owns ${this.stateDir}, and this CLI would change its database schema. Use the \`t3\` that matches the running server, or stop that server, then retry. The database was not changed.`;
  }
}

// SQLITE_CORRUPT and SQLITE_NOTADB; node:sqlite reports extended codes whose low byte is the primary code.
const DAMAGED_SQLITE_CODES = new Set([11, 26]);

const isDamagedDatabase = (error: SqlError.SqlError): boolean => {
  const seen = new Set<unknown>();
  let cause: unknown = error.cause;
  while (Predicate.isObject(cause) && !seen.has(cause)) {
    seen.add(cause);
    if (typeof cause.errcode === "number" && DAMAGED_SQLITE_CODES.has(cause.errcode & 0xff)) {
      return true;
    }
    cause = cause.cause;
  }
  return false;
};

// Keeps the SqlError type so callers' error channels do not change; the original stays as the cause.
const damagedDatabaseError = (dbPath: string, cause: SqlError.SqlError) =>
  new SqlError.SqlError({
    reason: new SqlError.UnknownError({
      cause,
      operation: "open",
      message: `The CMDeck database at ${dbPath} is damaged or is not a SQLite database, so CMDeck cannot start. To recover, quit CMDeck, then move that file and any -wal and -shm files next to it out of the folder, or replace them with a backup. CMDeck creates a new database on the next start.`,
    }),
  });

// CLI commands open the server's database from another process; migrating behind its owner changes the schema it runs on.
const runMigrationsAsOwner = Effect.fn("SqlitePersistence.runMigrationsAsOwner")(function* () {
  // With nothing pending, runMigrations only validates the recorded history and writes nothing.
  if (!(yield* hasPendingMigrations())) return yield* runMigrations();
  const { serverRuntimeStatePath } = yield* ServerConfig.ServerConfig;
  yield* ServerOwnership.holdServerOwnershipLock(serverRuntimeStatePath).pipe(
    Effect.catchTags({
      ServerAlreadyRunningError: ({ stateDir }) =>
        Effect.fail(new ServerOwnsDatabaseError({ stateDir })),
    }),
  );
  yield* runMigrations();
}, Effect.scoped);

const makeLayerSetup = <E, R>(
  migrate: Effect.Effect<unknown, E, R>,
  pragmas: ReadonlyArray<string> = [],
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
      yield* sql`PRAGMA busy_timeout = 5000;`;
      yield* sql`PRAGMA foreign_keys = ON;`;
      // Existing databases need doctor's offline VACUUM to add pointer maps for this mode.
      const tables = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'`;
      if (tables[0]?.count === 0) yield* sql`PRAGMA auto_vacuum = INCREMENTAL;`;
      yield* sql`PRAGMA journal_mode = WAL;`;
      // FULL fsyncs every event commit; NORMAL syncs only at WAL checkpoints.
      // App crashes lose nothing; OS crashes or power loss can roll back post-checkpoint commits without corruption.
      yield* sql`PRAGMA synchronous = NORMAL;`;
      // macOS fsync misses drive caches; F_FULLFSYNC flushes them at checkpoints and is ignored elsewhere.
      yield* sql`PRAGMA checkpoint_fullfsync = ON;`;
      // Keep statement journals and sort spills off the disk.
      // Large statements and open savepoints can increase peak memory use.
      yield* sql`PRAGMA temp_store = MEMORY;`;
      // PASSIVE checkpoints retain peak WAL size until the last connection closes.
      yield* sql.unsafe(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT_BYTES};`);
      // One statement each: a prepared statement runs only the first of several.
      for (const pragma of pragmas) yield* sql.unsafe(pragma);
      yield* migrate;
      // Collecting stats scans every page, and stale small-table stats cause scans after growth; use indexes by default.
      // Connections cache stats; reload after deleting them.
      const statTables = yield* sql`SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_stat1'`;
      if (statTables.length > 0) {
        yield* sql`DELETE FROM sqlite_stat1;`;
        yield* sql`ANALYZE sqlite_schema;`;
      }
    }).pipe(Effect.withSpan("Sqlite.setup")),
  );

const layerSetup = makeLayerSetup(runMigrations());

const makeLayerFromPath = <E, R>(
  makeSetup: (pragmas: ReadonlyArray<string>) => Layer.Layer<never, E, R>,
) =>
  Effect.fn("makeSqlitePersistenceLive")(function* (dbPath: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
    const mmapBytes = yield* readMmapBytes(dbPath);
    // SQLite's default page cache is about 2 MiB; a cache fills only as pages are read.
    const pragmas = ["PRAGMA cache_size = -64000;", `PRAGMA mmap_size = ${mmapBytes};`];

    return Layer.provideMerge(
      makeSetup(pragmas),
      NodeSqliteClient.layer({
        filename: dbPath,
        readerWorker: true,
        readerPragmas: `PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32000; PRAGMA mmap_size = ${mmapBytes};`,
        // A slow disk then delays writes instead of freezing every client.
        writerWorker: true,
        spanAttributes: {
          "db.name": path.basename(dbPath),
          "service.name": "t3code-server",
        },
      }),
    ).pipe(
      Layer.catchTag("SqlError", (error) =>
        Layer.effect(
          SqlClient.SqlClient,
          Effect.fail(
            SqlError.isSqlError(error) && isDamagedDatabase(error)
              ? damagedDatabaseError(dbPath, error)
              : error,
          ),
        ),
      ),
    );
  }, Layer.unwrap);

export const layerFromPath = makeLayerFromPath((pragmas) =>
  makeLayerSetup(runMigrations(), pragmas),
);

export const layerMemory = Layer.provideMerge(
  layerSetup,
  NodeSqliteClient.layer({ filename: ":memory:" }),
);

const makeLayerConfig = <E, R>(
  fromPath: (dbPath: string) => Layer.Layer<SqlClient.SqlClient, E, R>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { dbPath } = yield* ServerConfig.ServerConfig;
      yield* initializeV2Database(dbPath);
      return fromPath(dbPath);
    }),
  );

export const layerConfig = makeLayerConfig(layerFromPath);

/** For CLI commands: pending migrations run only while no server owns the T3 home. */
export const layerCliConfig = makeLayerConfig(
  makeLayerFromPath((pragmas) => makeLayerSetup(runMigrationsAsOwner(), pragmas)),
);
