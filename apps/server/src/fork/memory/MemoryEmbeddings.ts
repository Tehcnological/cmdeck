import {
  type MemoryEmbedderSetting,
  type MemoryEmbeddingsStatus,
  type MemoryKind,
  type ServerSettings,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";

import { parseBaseUrl } from "../../inference/InferenceServerRegistry.ts";
import { requireSettingsSecret } from "../../secrets/settingsSecretValue.ts";
import * as Settings from "../../serverSettings.ts";
import { isLocalModelAddress } from "../decisions/Decisions.ts";
import { cosineSimilarity } from "./retrieval.ts";

/** Items embedded alongside each query; the rest are embedded in the background. */
const BATCH = 32;
const REQUEST_TIMEOUT = Duration.seconds(5);
/** After a failure, searches stay on keywords this long instead of waiting on the embedder again. */
const RETRY_AFTER_MS = 60_000;

export interface VectorMatch {
  readonly itemId: string;
  readonly cosine: number;
}

/**
 * Optional vectors for memory search from a registered inference server's `/embeddings`. Without an
 * embedder it makes no request; when the embedder fails, search falls back to keywords and the
 * status says why.
 */
export class MemoryEmbeddings extends Context.Service<
  MemoryEmbeddings,
  {
    /**
     * The readable active items closest in meaning to `text`, best first, after embedding up to a
     * batch of items that lack a vector. None means keyword search only. Never fails.
     */
    readonly match: (input: {
      readonly text: string;
      readonly scopes: ReadonlyArray<string>;
      readonly kind?: MemoryKind;
      readonly limit: number;
    }) => Effect.Effect<Option.Option<ReadonlyArray<VectorMatch>>>;
    /** Embeds every active item without a vector from the current embedder; returns how many. */
    readonly backfill: Effect.Effect<number>;
    /**
     * Embeds other text (knowledge chunks) with the same embedder and the same failure handling.
     * None without a usable embedder or while it cools down after a failure. Never fails.
     */
    /** The usable embedder's signature, read from settings without a request. */
    readonly signature: Effect.Effect<Option.Option<string>>;
    readonly embed: (texts: ReadonlyArray<string>) => Effect.Effect<
      Option.Option<{
        readonly signature: string;
        readonly vectors: ReadonlyArray<Float32Array>;
      }>
    >;
    readonly status: Effect.Effect<MemoryEmbeddingsStatus>;
  }
>()("t3/fork/memory/MemoryEmbeddings") {}

/** Names the embedder; a vector from another signature is never compared with this one's. */
const embedderSignature = (setting: MemoryEmbedderSetting, baseUrl: string) =>
  `${setting.serverId}\n${baseUrl}\n${setting.model}`;

type Resolved =
  | { readonly _tag: "Off" }
  | {
      readonly _tag: "Unusable";
      readonly setting: MemoryEmbedderSetting;
      readonly message: string;
    }
  | {
      readonly _tag: "Ready";
      readonly setting: MemoryEmbedderSetting;
      readonly signature: string;
      readonly url: string;
      readonly apiKey: SettingsSecretValue;
    };

/** The embedder settings name, checked without any request. */
const resolveEmbedder = (settings: ServerSettings): Resolved => {
  const setting = settings.cmdeck.memoryEmbedder;
  if (!settings.cmdeck.memoryEnabled || setting === null) return { _tag: "Off" };
  const server = settings.inferenceServers[setting.serverId];
  if (server === undefined) {
    return { _tag: "Unusable", setting, message: "The chosen inference server was removed." };
  }
  if (!server.enabled) {
    return { _tag: "Unusable", setting, message: "The chosen inference server is turned off." };
  }
  const endpoint = parseBaseUrl(server.baseUrl);
  if ("error" in endpoint) return { _tag: "Unusable", setting, message: endpoint.error };
  // Memory holds what the user told CMDeck; it only goes to a server on this machine or network.
  if (!isLocalModelAddress(endpoint.base)) {
    return {
      _tag: "Unusable",
      setting,
      message: "Memory is only embedded on this machine, the local network or the tailnet.",
    };
  }
  return {
    _tag: "Ready",
    setting,
    signature: embedderSignature(setting, endpoint.base),
    url: `${endpoint.base}/embeddings`,
    apiKey: server.apiKey,
  };
};

const EmbeddingsResponse = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Array(
      Schema.Struct({ index: Schema.Number, embedding: Schema.Array(Schema.Number) }),
    ),
  }),
);
const decodeEmbeddings = Schema.decodeUnknownOption(EmbeddingsResponse);

export const toBlob = (vector: Float32Array) => new Uint8Array(vector.buffer.slice(0));
export const fromBlob = (blob: Uint8Array) =>
  new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));

interface Health {
  readonly signature: string;
  readonly failedAtMs: number;
  readonly message: string;
  readonly checkedAt: string;
}

class EmbedFailure extends Schema.TaggedError<EmbedFailure>()("EmbedFailure", {
  message: Schema.String,
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settingsService = yield* Settings.ServerSettingsService;
  const client = yield* HttpClient.HttpClient;
  const secrets = yield* SecretResolver.SecretResolver;
  const layerScope = yield* Scope.Scope;
  const health = yield* Ref.make<Health | null>(null);
  const lastOk = yield* Ref.make<{ readonly signature: string; readonly at: string } | null>(null);
  const backfilling = yield* Ref.make(false);

  const resolved = settingsService.getSettings.pipe(
    Effect.map(resolveEmbedder),
    Effect.orElseSucceed((): Resolved => ({ _tag: "Off" })),
  );

  const embed = Effect.fn("MemoryEmbeddings.embed")(function* (
    embedder: Extract<Resolved, { _tag: "Ready" }>,
    texts: ReadonlyArray<string>,
  ) {
    const apiKey = yield* requireSettingsSecret(secrets, embedder.apiKey).pipe(
      Effect.map((value) => value.trim()),
      Effect.mapError(
        () => new EmbedFailure({ message: "Could not read the API key from its secret provider." }),
      ),
    );
    const request = HttpClientRequest.post(embedder.url).pipe(
      HttpClientRequest.bodyJsonUnsafe({ model: embedder.setting.model, input: texts }),
      apiKey === "" ? (request) => request : HttpClientRequest.bearerToken(apiKey),
    );
    const response = yield* client.execute(request).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (body) => ({ status: response.status, body })),
      ),
      Effect.timeoutOption(REQUEST_TIMEOUT),
      Effect.mapError(() => new EmbedFailure({ message: "The inference server is unreachable." })),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new EmbedFailure({ message: "The inference server did not answer." })),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new EmbedFailure({
        message: `The inference server answered ${response.status} to an embeddings request; check that the model embeds.`,
      });
    }
    const decoded = decodeEmbeddings(response.body);
    const vectors = Option.isSome(decoded)
      ? decoded.value.data.toSorted((left, right) => left.index - right.index)
      : [];
    const dimension = vectors[0]?.embedding.length ?? 0;
    if (
      vectors.length !== texts.length ||
      dimension === 0 ||
      vectors.some((vector) => vector.embedding.length !== dimension)
    ) {
      return yield* new EmbedFailure({
        message: "The inference server's answer held no usable embeddings.",
      });
    }
    return vectors.map((vector) => Float32Array.from(vector.embedding));
  });

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));

  const recordFailure = Effect.fn("MemoryEmbeddings.recordFailure")(function* (
    signature: string,
    failure: EmbedFailure,
  ) {
    yield* Ref.set(health, {
      signature,
      failedAtMs: yield* nowMs,
      message: failure.message,
      checkedAt: yield* now,
    });
    yield* Effect.logWarning("Memory embeddings unavailable; memory search uses keywords.", {
      reason: failure.message,
    });
  });

  const recordSuccess = Effect.fn("MemoryEmbeddings.recordSuccess")(function* (signature: string) {
    yield* Ref.set(health, null);
    yield* Ref.set(lastOk, { signature, at: yield* now });
  });

  const coolingDown = Effect.fn("MemoryEmbeddings.coolingDown")(function* (signature: string) {
    const last = yield* Ref.get(health);
    return (
      last !== null &&
      last.signature === signature &&
      (yield* nowMs) - last.failedAtMs < RETRY_AFTER_MS
    );
  });

  const missing = (signature: string, limit: number) =>
    sql<{ readonly id: string; readonly content: string }>`
      SELECT items.id, items.content FROM memory_items AS items
      LEFT JOIN memory_embeddings AS vectors
        ON vectors.item_id = items.id AND vectors.signature = ${signature}
      WHERE items.status = 'active' AND vectors.item_id IS NULL
      ORDER BY items.updated_at DESC LIMIT ${limit}`;

  const store = Effect.fn("MemoryEmbeddings.store")(function* (
    signature: string,
    items: ReadonlyArray<{ readonly id: string; readonly content: string }>,
    vectors: ReadonlyArray<Float32Array>,
  ) {
    const at = yield* now;
    // The content check and the write are one statement: an item edited while its old text was
    // being embedded keeps no vector, so the next search embeds the new text.
    yield* sql.withTransaction(
      Effect.forEach(
        items,
        (item, index) =>
          sql`INSERT INTO memory_embeddings (item_id, signature, vector, embedded_at)
            SELECT id, ${signature}, ${toBlob(vectors[index]!)}, ${at} FROM memory_items
            WHERE id = ${item.id} AND content = ${item.content}
            ON CONFLICT (item_id) DO UPDATE SET signature = excluded.signature,
              vector = excluded.vector, embedded_at = excluded.embedded_at`,
        { discard: true },
      ),
    );
  });

  const backfillWith = Effect.fn("MemoryEmbeddings.backfillWith")(function* (
    embedder: Extract<Resolved, { _tag: "Ready" }>,
  ) {
    let embedded = 0;
    while (true) {
      const batch = yield* missing(embedder.signature, BATCH);
      if (batch.length === 0) return embedded;
      const vectors = yield* embed(
        embedder,
        batch.map((item) => item.content),
      );
      yield* store(embedder.signature, batch, vectors);
      yield* recordSuccess(embedder.signature);
      embedded += batch.length;
      if (batch.length < BATCH) return embedded;
    }
  });

  const runBackfill = (embedder: Extract<Resolved, { _tag: "Ready" }>) =>
    backfillWith(embedder).pipe(
      Effect.catchTags({
        EmbedFailure: (failure) => recordFailure(embedder.signature, failure).pipe(Effect.as(0)),
        SqlError: (cause) =>
          Effect.logWarning("Memory embeddings could not be saved.", cause).pipe(Effect.as(0)),
      }),
    );

  /** One background backfill at a time; it ends with the server. */
  const backfillInBackground = (embedder: Extract<Resolved, { _tag: "Ready" }>) =>
    Ref.getAndSet(backfilling, true).pipe(
      Effect.flatMap((running) =>
        running
          ? Effect.void
          : runBackfill(embedder).pipe(
              Effect.ensuring(Ref.set(backfilling, false)),
              Effect.forkIn(layerScope),
              Effect.asVoid,
            ),
      ),
    );

  const match: MemoryEmbeddings["Service"]["match"] = Effect.fn("MemoryEmbeddings.match")(
    function* (input) {
      const embedder = yield* resolved;
      if (embedder._tag !== "Ready" || input.scopes.length === 0) return Option.none();
      if (yield* coolingDown(embedder.signature)) return Option.none();
      const pending = yield* missing(embedder.signature, BATCH);
      const embedded = yield* embed(embedder, [input.text, ...pending.map((item) => item.content)]);
      const [query, ...vectors] = embedded;
      yield* store(embedder.signature, pending, vectors);
      yield* recordSuccess(embedder.signature);
      if (pending.length === BATCH) yield* backfillInBackground(embedder);
      const rows = yield* sql<{ readonly itemId: string; readonly vector: Uint8Array }>`
        SELECT vectors.item_id AS "itemId", vectors.vector FROM memory_embeddings AS vectors
        INNER JOIN memory_items AS items ON items.id = vectors.item_id
        WHERE vectors.signature = ${embedder.signature}
          AND items.status = 'active'
          AND items.scope IN ${sql.in(input.scopes)}
          ${input.kind === undefined ? sql`` : sql`AND items.kind = ${input.kind}`}`;
      return Option.some(
        rows
          .map((row) => ({
            itemId: row.itemId,
            cosine: cosineSimilarity(query!, fromBlob(row.vector)),
          }))
          .toSorted((left, right) => right.cosine - left.cosine)
          .slice(0, input.limit),
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchTags({
          EmbedFailure: (failure) =>
            resolved.pipe(
              Effect.flatMap((embedder) =>
                embedder._tag === "Ready"
                  ? recordFailure(embedder.signature, failure)
                  : Effect.void,
              ),
              Effect.as(Option.none()),
            ),
          SqlError: (cause) =>
            Effect.logWarning("Memory vector search failed; using keywords.", {
              cause,
              scopes: input.scopes.length,
            }).pipe(Effect.as(Option.none())),
        }),
      ),
  );

  const backfill: MemoryEmbeddings["Service"]["backfill"] = resolved.pipe(
    Effect.flatMap((embedder) =>
      embedder._tag === "Ready" ? runBackfill(embedder) : Effect.succeed(0),
    ),
    Effect.withSpan("MemoryEmbeddings.backfill"),
  );

  const status: MemoryEmbeddings["Service"]["status"] = Effect.gen(function* () {
    const embedder = yield* resolved;
    const counts = yield* sql<{ readonly total: number; readonly embedded: number }>`
      SELECT COUNT(*) AS total, COUNT(vectors.item_id) AS embedded
      FROM memory_items AS items
      LEFT JOIN memory_embeddings AS vectors
        ON vectors.item_id = items.id AND vectors.signature = ${
          embedder._tag === "Ready" ? embedder.signature : ""
        }
      WHERE items.status = 'active'`.pipe(
      Effect.map((rows) => rows[0] ?? { total: 0, embedded: 0 }),
      Effect.orElseSucceed(() => ({ total: 0, embedded: 0 })),
    );
    const base = { total: counts.total, embedded: counts.embedded };
    switch (embedder._tag) {
      case "Off":
        return { ...base, mode: "keyword", embedder: null, embedded: 0, checkedAt: null } as const;
      case "Unusable":
        return {
          ...base,
          mode: "unavailable",
          embedder: embedder.setting,
          embedded: 0,
          message: embedder.message,
          checkedAt: null,
        } as const;
      case "Ready": {
        const failed = yield* Ref.get(health);
        if (failed !== null && failed.signature === embedder.signature) {
          return {
            ...base,
            mode: "unavailable",
            embedder: embedder.setting,
            message: failed.message,
            checkedAt: failed.checkedAt,
          } as const;
        }
        const ok = yield* Ref.get(lastOk);
        return {
          ...base,
          mode: "hybrid",
          embedder: embedder.setting,
          checkedAt: ok !== null && ok.signature === embedder.signature ? ok.at : null,
        } as const;
      }
    }
  }).pipe(Effect.withSpan("MemoryEmbeddings.status"));

  const embedOther: MemoryEmbeddings["Service"]["embed"] = Effect.fn("MemoryEmbeddings.embed")(
    function* (texts) {
      const embedder = yield* resolved;
      if (embedder._tag !== "Ready" || texts.length === 0) return Option.none();
      if (yield* coolingDown(embedder.signature)) return Option.none();
      return yield* embed(embedder, texts).pipe(
        Effect.tap(() => recordSuccess(embedder.signature)),
        Effect.map((vectors) => Option.some({ signature: embedder.signature, vectors })),
        Effect.catchTags({
          EmbedFailure: (failure) =>
            recordFailure(embedder.signature, failure).pipe(Effect.as(Option.none())),
        }),
      );
    },
  );

  const signature: MemoryEmbeddings["Service"]["signature"] = resolved.pipe(
    Effect.map((embedder) =>
      embedder._tag === "Ready" ? Option.some(embedder.signature) : Option.none(),
    ),
  );

  return MemoryEmbeddings.of({ match, backfill, status, signature, embed: embedOther });
});

export const layer = Layer.effect(MemoryEmbeddings, make);
