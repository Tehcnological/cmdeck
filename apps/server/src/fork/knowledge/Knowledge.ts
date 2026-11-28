import {
  type KnowledgeAddSourceInput,
  KnowledgeError,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as MemoryEmbeddings from "../memory/MemoryEmbeddings.ts";
import { bm25RankToScore, cosineSimilarity, ftsQuery } from "../memory/retrieval.ts";
import { chunkText } from "./chunker.ts";
import {
  type FoundFile,
  readText,
  resolveSourcePath,
  sourceFilePath,
  walkSource,
} from "./files.ts";

/** A search refreshes a source whose last index is older than this, in the background. */
const STALE_AFTER_MS = 5 * 60 * 1000;
const EMBED_BATCH = 32;
// Hybrid weights as in memory search (retrieval.ts, ported from openclaw).
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const MIN_VECTOR_ONLY_SCORE = 0.35;
const CANDIDATE_MULTIPLIER = 4;

export interface KnowledgeHit {
  readonly sourceId: string;
  readonly kind: KnowledgeSourceKind;
  /** The file's absolute path. */
  readonly path: string;
  readonly lineStart: number;
  readonly content: string;
}

export interface IndexResult {
  /** Files chunked again because their content changed or they are new. */
  readonly indexed: number;
  readonly unchanged: number;
  /** Files gone from the source, or now excluded, taken out of the index. */
  readonly removed: number;
}

interface SourceRow {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly kind: KnowledgeSourceKind;
  readonly path: string;
  readonly indexedAt: string | null;
  readonly skipped: number;
  readonly lastError: string | null;
}

export class Knowledge extends Context.Service<
  Knowledge,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<KnowledgeSource>, KnowledgeError>;
    /** Adds a source and starts indexing it in the background. */
    readonly addSource: (
      input: KnowledgeAddSourceInput,
    ) => Effect.Effect<KnowledgeSource, KnowledgeError>;
    /** Stops any index run and drops the source's index. Files on disk are untouched. */
    readonly removeSource: (sourceId: string) => Effect.Effect<void, KnowledgeError>;
    /** Starts an incremental index run in the background unless one is running. */
    readonly reindex: (sourceId: string) => Effect.Effect<KnowledgeSource, KnowledgeError>;
    /** Stops a running index run; what it already indexed stays. */
    readonly cancel: (sourceId: string) => Effect.Effect<KnowledgeSource, KnowledgeError>;
    /** One incremental index run, in the caller's fiber. */
    readonly indexNow: (sourceId: string) => Effect.Effect<IndexResult, KnowledgeError>;
    /** The best chunks from the project's sources. Never reads another project's. */
    readonly search: (input: {
      readonly projectId: ProjectId;
      readonly query: string;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<KnowledgeHit>, KnowledgeError>;
    readonly projectForThread: (threadId: ThreadId) => Effect.Effect<ProjectId | null>;
  }
>()("t3/fork/knowledge/Knowledge") {}

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const failsTo =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.mapError(
        (cause) => new KnowledgeError({ message: `Could not ${operation}: ${errorText(cause)}` }),
      ),
    );

/** A filesystem promise as an Effect failing with a KnowledgeError. */
const fromPromise = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new KnowledgeError({ message: `Could not ${operation}: ${errorText(cause)}` }),
  });

interface Running {
  readonly token: object;
  readonly fiber: Fiber.Fiber<unknown, unknown> | null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const random = yield* SecureRandom.SecureRandom;
  // Optional: without it, or without an embedder configured, search is keyword-only.
  const embeddings = yield* Effect.serviceOption(MemoryEmbeddings.MemoryEmbeddings);
  const layerScope = yield* Scope.Scope;
  const env = { platform: yield* HostProcess.Platform, home: yield* HostProcess.HomeDirectory };
  const running = yield* Ref.make(new Map<string, Running>());
  const backfilling = yield* Ref.make(false);

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const selectSources = sql.literal(`SELECT id, project_id AS "projectId", kind, path,
    indexed_at AS "indexedAt", skipped, last_error AS "lastError" FROM knowledge_sources`);

  const findSource = (sourceId: string) =>
    sql<SourceRow>`${selectSources} WHERE id = ${sourceId}`.pipe(
      Effect.map((rows) => rows[0]),
      failsTo("read the source"),
      Effect.filterOrFail(
        (row): row is SourceRow => row !== undefined,
        () => new KnowledgeError({ message: "That knowledge source no longer exists." }),
      ),
    );

  const describe = Effect.fn("Knowledge.describe")(function* (rows: ReadonlyArray<SourceRow>) {
    if (rows.length === 0) return [];
    const counts = yield* sql<{
      readonly sourceId: string;
      readonly files: number;
      readonly chunks: number;
    }>`
      SELECT files.source_id AS "sourceId", COUNT(*) AS files,
        (SELECT COUNT(*) FROM knowledge_chunks AS chunks WHERE chunks.source_id = files.source_id) AS chunks
      FROM knowledge_files AS files
      WHERE files.source_id IN ${sql.in(rows.map((row) => row.id))}
      GROUP BY files.source_id`;
    const active = yield* Ref.get(running);
    return rows.map((row): KnowledgeSource => {
      const count = counts.find((entry) => entry.sourceId === row.id);
      return {
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
        path: row.path,
        state: active.has(row.id)
          ? "indexing"
          : row.lastError !== null
            ? "error"
            : row.indexedAt === null
              ? "pending"
              : "ready",
        files: count?.files ?? 0,
        chunks: count?.chunks ?? 0,
        skipped: row.skipped,
        indexedAt: row.indexedAt,
        message: row.lastError,
      };
    });
  });

  const describeOne = (sourceId: string) =>
    findSource(sourceId).pipe(
      Effect.flatMap((row) => describe([row]).pipe(failsTo("read the source"))),
      Effect.map((described) => described[0]!),
    );

  /** Replaces one file's chunks and row in one transaction, so a stopped run leaves no half file. */
  const writeFile = (
    sourceId: string,
    file: FoundFile,
    read: { readonly text: string; readonly hash: string } | null,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM knowledge_chunks WHERE source_id = ${sourceId} AND rel_path = ${file.relPath}`;
        for (const chunk of read === null ? [] : chunkText(read.text)) {
          yield* sql`INSERT INTO knowledge_chunks (source_id, rel_path, line_start, content)
            VALUES (${sourceId}, ${file.relPath}, ${chunk.lineStart}, ${chunk.content})`;
        }
        // An empty hash marks a binary or unreadable file, kept so it is not read again unchanged.
        yield* sql`INSERT INTO knowledge_files (source_id, rel_path, size, mtime_ms, hash)
          VALUES (${sourceId}, ${file.relPath}, ${file.size}, ${file.mtimeMs}, ${read?.hash ?? ""})
          ON CONFLICT (source_id, rel_path) DO UPDATE SET size = excluded.size,
            mtime_ms = excluded.mtime_ms, hash = excluded.hash`;
      }),
    );

  const indexNow: Knowledge["Service"]["indexNow"] = Effect.fn("Knowledge.indexNow")(
    function* (sourceId) {
      const source = yield* findSource(sourceId);
      const walk = yield* fromPromise("read the source folder", (signal) =>
        walkSource(env, source.path, source.kind, () => signal.aborted),
      );
      const previous = new Map(
        (yield* sql<{
          readonly relPath: string;
          readonly size: number;
          readonly mtimeMs: number;
          readonly hash: string;
        }>`SELECT rel_path AS "relPath", size, mtime_ms AS "mtimeMs", hash
          FROM knowledge_files WHERE source_id = ${sourceId}`.pipe(failsTo("read the index"))).map(
          (row) => [row.relPath, row],
        ),
      );
      let indexed = 0;
      let unchanged = 0;
      for (const file of walk.files) {
        const before = previous.get(file.relPath);
        previous.delete(file.relPath);
        if (before !== undefined && before.size === file.size && before.mtimeMs === file.mtimeMs) {
          unchanged++;
          continue;
        }
        const read = yield* fromPromise("read a file", () => readText(file.absPath)).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (before !== undefined && before.hash === (read?.hash ?? "")) {
          // Touched but not changed: the hash says the chunks still hold.
          yield* sql`UPDATE knowledge_files SET size = ${file.size}, mtime_ms = ${file.mtimeMs}
            WHERE source_id = ${sourceId} AND rel_path = ${file.relPath}`.pipe(
            failsTo("update the index"),
          );
          unchanged++;
          continue;
        }
        yield* writeFile(sourceId, file, read).pipe(failsTo("update the index"));
        indexed++;
      }
      // What the walk no longer found was deleted or is now excluded.
      for (const relPath of previous.keys()) {
        yield* sql
          .withTransaction(
            Effect.all([
              sql`DELETE FROM knowledge_chunks WHERE source_id = ${sourceId} AND rel_path = ${relPath}`,
              sql`DELETE FROM knowledge_files WHERE source_id = ${sourceId} AND rel_path = ${relPath}`,
            ]),
          )
          .pipe(failsTo("update the index"));
      }
      const unreadable = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM knowledge_files WHERE source_id = ${sourceId} AND hash = ''`.pipe(
        Effect.map((rows) => rows[0]?.count ?? 0),
        failsTo("read the index"),
      );
      yield* sql`UPDATE knowledge_sources SET indexed_at = ${yield* now},
        skipped = ${walk.skipped + unreadable}, last_error = NULL WHERE id = ${sourceId}`.pipe(
        failsTo("update the source"),
      );
      return { indexed, unchanged, removed: previous.size };
    },
  );

  const start = Effect.fn("Knowledge.start")(function* (sourceId: string) {
    const token = {};
    const claimed = yield* Ref.modify(running, (map): [boolean, Map<string, Running>] =>
      map.has(sourceId) ? [false, map] : [true, new Map(map).set(sourceId, { token, fiber: null })],
    );
    if (!claimed) return;
    const release = Ref.update(running, (map) => {
      if (map.get(sourceId)?.token !== token) return map;
      const next = new Map(map);
      next.delete(sourceId);
      return next;
    });
    const fiber = yield* indexNow(sourceId).pipe(
      Effect.catchTags({
        KnowledgeError: (error) =>
          sql`UPDATE knowledge_sources SET last_error = ${error.message} WHERE id = ${sourceId}`.pipe(
            Effect.ignore,
          ),
      }),
      Effect.ensuring(release),
      Effect.forkIn(layerScope),
    );
    yield* Ref.update(running, (map) =>
      map.get(sourceId)?.token === token ? new Map(map).set(sourceId, { token, fiber }) : map,
    );
  });

  const stop = Effect.fn("Knowledge.stop")(function* (sourceId: string) {
    const entry = (yield* Ref.get(running)).get(sourceId);
    if (entry === undefined) return;
    if (entry.fiber !== null) yield* Fiber.interrupt(entry.fiber);
    // A fiber interrupted before it started never runs its own release.
    yield* Ref.update(running, (map) => {
      if (map.get(sourceId)?.token !== entry.token) return map;
      const next = new Map(map);
      next.delete(sourceId);
      return next;
    });
  });

  const list: Knowledge["Service"]["list"] = (projectId) =>
    sql<SourceRow>`${selectSources} WHERE project_id = ${projectId} ORDER BY created_at`.pipe(
      Effect.flatMap(describe),
      failsTo("list knowledge sources"),
    );

  const addSource: Knowledge["Service"]["addSource"] = Effect.fn("Knowledge.addSource")(
    function* (input) {
      const shell = yield* projects.getShell(input.projectId).pipe(failsTo("read the project"));
      if (Option.isNone(shell)) {
        return yield* new KnowledgeError({ message: "That project no longer exists." });
      }
      const resolved = yield* fromPromise("open that path", () =>
        resolveSourcePath({
          env,
          projectRoot: shell.value.workspaceRoot,
          kind: input.kind,
          path: input.path.trim(),
        }),
      );
      if (resolved._tag === "Refused")
        return yield* new KnowledgeError({ message: resolved.message });
      const existing = yield* sql<{ readonly kind: string; readonly path: string }>`
        SELECT kind, path FROM knowledge_sources WHERE project_id = ${input.projectId}`.pipe(
        failsTo("list knowledge sources"),
      );
      if (existing.some((row) => row.path === resolved.path)) {
        return yield* new KnowledgeError({
          message: "That path is already a source of this project.",
        });
      }
      if (input.kind === "notes" && existing.some((row) => row.kind === "notes")) {
        return yield* new KnowledgeError({
          message: "This project already has a notes folder. Remove it first to choose another.",
        });
      }
      const id = yield* random.uuidV4().pipe(failsTo("name the source"));
      yield* sql`INSERT INTO knowledge_sources (id, project_id, kind, path, created_at)
        VALUES (${id}, ${input.projectId}, ${input.kind}, ${resolved.path}, ${yield* now})`.pipe(
        failsTo("save the source"),
      );
      yield* start(id);
      return yield* describeOne(id);
    },
  );

  const removeSource: Knowledge["Service"]["removeSource"] = Effect.fn("Knowledge.removeSource")(
    function* (sourceId) {
      yield* stop(sourceId);
      yield* sql
        .withTransaction(
          Effect.all([
            sql`DELETE FROM knowledge_chunks WHERE source_id = ${sourceId}`,
            sql`DELETE FROM knowledge_files WHERE source_id = ${sourceId}`,
            sql`DELETE FROM knowledge_sources WHERE id = ${sourceId}`,
          ]),
        )
        .pipe(failsTo("remove the source"));
    },
  );

  const reindex: Knowledge["Service"]["reindex"] = (sourceId) =>
    findSource(sourceId).pipe(
      Effect.andThen(start(sourceId)),
      Effect.andThen(describeOne(sourceId)),
    );

  const cancel: Knowledge["Service"]["cancel"] = (sourceId) =>
    findSource(sourceId).pipe(
      Effect.andThen(stop(sourceId)),
      Effect.andThen(describeOne(sourceId)),
    );

  const missingVectors = (sourceIds: ReadonlyArray<string>, signature: string) =>
    sql<{ readonly seq: number; readonly content: string }>`
      SELECT chunks.seq, chunks.content FROM knowledge_chunks AS chunks
      LEFT JOIN knowledge_vectors AS vectors
        ON vectors.chunk_seq = chunks.seq AND vectors.signature = ${signature}
      WHERE chunks.source_id IN ${sql.in(sourceIds)} AND vectors.chunk_seq IS NULL
      LIMIT ${EMBED_BATCH}`;

  // A chunk deleted while it was embedded gets no vector.
  const storeVectors = (
    signature: string,
    chunks: ReadonlyArray<{ readonly seq: number }>,
    vectors: ReadonlyArray<Float32Array>,
  ) =>
    sql.withTransaction(
      Effect.forEach(
        chunks,
        (chunk, index) =>
          sql`INSERT INTO knowledge_vectors (chunk_seq, signature, vector)
            SELECT seq, ${signature}, ${MemoryEmbeddings.toBlob(vectors[index]!)}
            FROM knowledge_chunks WHERE seq = ${chunk.seq}
            ON CONFLICT (chunk_seq) DO UPDATE SET signature = excluded.signature,
              vector = excluded.vector`,
        { discard: true },
      ),
    );

  /** Embeds the rest of these sources' chunks; one run at a time, ending with the server. */
  const backfillVectors = Effect.fn("Knowledge.backfillVectors")(
    function* (
      service: MemoryEmbeddings.MemoryEmbeddings["Service"],
      sourceIds: ReadonlyArray<string>,
      signature: string,
    ) {
      while (true) {
        const batch = yield* missingVectors(sourceIds, signature);
        if (batch.length === 0) return;
        const embedded = yield* service.embed(batch.map((chunk) => chunk.content));
        if (Option.isNone(embedded) || embedded.value.signature !== signature) return;
        yield* storeVectors(signature, batch, embedded.value.vectors);
        if (batch.length < EMBED_BATCH) return;
      }
    },
    Effect.catchTags({
      SqlError: (cause) => Effect.logWarning("Knowledge vectors could not be saved.", cause),
    }),
  );

  const backfillInBackground = (
    service: MemoryEmbeddings.MemoryEmbeddings["Service"],
    sourceIds: ReadonlyArray<string>,
    signature: string,
  ) =>
    Ref.getAndSet(backfilling, true).pipe(
      Effect.flatMap((busy) =>
        busy
          ? Effect.void
          : backfillVectors(service, sourceIds, signature).pipe(
              Effect.ensuring(Ref.set(backfilling, false)),
              Effect.forkIn(layerScope),
              Effect.asVoid,
            ),
      ),
    );

  /**
   * Cosine similarity of the closest embedded chunks, or null without a usable embedder. The query
   * goes out with up to a batch of chunks still lacking a vector; the rest embed in the background.
   */
  const vectorMatches = Effect.fn("Knowledge.vectorMatches")(function* (
    sourceIds: ReadonlyArray<string>,
    query: string,
    limit: number,
  ) {
    if (Option.isNone(embeddings)) return null;
    const service = embeddings.value;
    const expected = yield* service.signature;
    if (Option.isNone(expected)) return null;
    const pending = yield* missingVectors(sourceIds, expected.value);
    const embedded = yield* service.embed([query, ...pending.map((chunk) => chunk.content)]);
    if (Option.isNone(embedded) || embedded.value.signature !== expected.value) return null;
    const [queryVector, ...vectors] = embedded.value.vectors;
    const signature = expected.value;
    yield* storeVectors(signature, pending, vectors);
    if (pending.length === EMBED_BATCH) yield* backfillInBackground(service, sourceIds, signature);
    // shortcut: compares every embedded chunk of the project in memory; move to a vector index if
    // libraries grow past tens of thousands of chunks.
    const rows = yield* sql<{ readonly seq: number; readonly vector: Uint8Array }>`
      SELECT vectors.chunk_seq AS seq, vectors.vector FROM knowledge_vectors AS vectors
      INNER JOIN knowledge_chunks AS chunks ON chunks.seq = vectors.chunk_seq
      WHERE vectors.signature = ${signature} AND chunks.source_id IN ${sql.in(sourceIds)}`;
    return new Map(
      rows
        .map(
          (row) =>
            [
              row.seq,
              cosineSimilarity(queryVector!, MemoryEmbeddings.fromBlob(row.vector)),
            ] as const,
        )
        .toSorted((left, right) => right[1] - left[1])
        .slice(0, limit),
    );
  });

  const search: Knowledge["Service"]["search"] = Effect.fn("Knowledge.search")(function* (input) {
    const sources =
      yield* sql<SourceRow>`${selectSources} WHERE project_id = ${input.projectId}`.pipe(
        failsTo("list knowledge sources"),
      );
    if (sources.length === 0) return [];
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    yield* Effect.forEach(
      sources.filter(
        (source) =>
          source.indexedAt === null || nowMs - Date.parse(source.indexedAt) > STALE_AFTER_MS,
      ),
      (source) => start(source.id),
      { discard: true },
    );
    const ids = sources.map((source) => source.id);
    const candidates = input.limit * CANDIDATE_MULTIPLIER;
    const match = ftsQuery(input.query);
    const keyword =
      match === null
        ? []
        : yield* sql<{ readonly seq: number; readonly bm25: number }>`
            SELECT chunks.seq, bm25(knowledge_fts) AS bm25 FROM knowledge_fts
            INNER JOIN knowledge_chunks AS chunks ON chunks.seq = knowledge_fts.rowid
            WHERE knowledge_fts MATCH ${match} AND chunks.source_id IN ${sql.in(ids)}
            ORDER BY bm25 LIMIT ${candidates}`.pipe(
            Effect.catchTags({
              SqlError: (cause) =>
                Effect.logWarning("Knowledge keyword search failed.", cause).pipe(Effect.as([])),
            }),
          );
    const vectors = yield* vectorMatches(ids, input.query, candidates).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.logWarning("Knowledge vector search failed; using keywords.", cause).pipe(
            Effect.as(null),
          ),
      }),
    );
    const bm25 = new Map(keyword.map((row) => [row.seq, row.bm25]));
    const scored = [...new Set([...bm25.keys(), ...(vectors?.keys() ?? [])])]
      .flatMap((seq) => {
        const rank = bm25.get(seq);
        const text = rank === undefined ? 0 : bm25RankToScore(rank);
        const score =
          vectors === null
            ? text
            : VECTOR_WEIGHT * Math.max(0, vectors.get(seq) ?? 0) + TEXT_WEIGHT * text;
        return rank === undefined && score < MIN_VECTOR_ONLY_SCORE ? [] : [{ seq, score }];
      })
      .toSorted((left, right) => right.score - left.score)
      .slice(0, input.limit);
    if (scored.length === 0) return [];
    const chunks = yield* sql<{
      readonly seq: number;
      readonly sourceId: string;
      readonly relPath: string;
      readonly lineStart: number;
      readonly content: string;
    }>`SELECT seq, source_id AS "sourceId", rel_path AS "relPath", line_start AS "lineStart", content
      FROM knowledge_chunks WHERE seq IN ${sql.in(scored.map((entry) => entry.seq))}`.pipe(
      failsTo("read the index"),
    );
    return scored.flatMap(({ seq }): ReadonlyArray<KnowledgeHit> => {
      const chunk = chunks.find((row) => row.seq === seq);
      const source = sources.find((row) => row.id === chunk?.sourceId);
      if (chunk === undefined || source === undefined) return [];
      return [
        {
          sourceId: source.id,
          kind: source.kind,
          path: sourceFilePath(source.path, source.kind, chunk.relPath),
          lineStart: chunk.lineStart,
          content: chunk.content,
        },
      ];
    });
  }, failsTo("search knowledge"));

  const projectForThread: Knowledge["Service"]["projectForThread"] = (threadId) =>
    projections.findThread(threadId).pipe(
      Effect.map((thread) => thread?.projectId ?? null),
      Effect.orElseSucceed(() => null),
    );

  return Knowledge.of({
    list,
    addSource,
    removeSource,
    reindex,
    cancel,
    indexNow,
    search,
    projectForThread,
  });
});

export const layerService = Layer.effect(Knowledge, make);

// MessagePins provides the projection store the same way in ForkLayer.
export const layer = layerService.pipe(Layer.provide(ProjectionStore.layer));
