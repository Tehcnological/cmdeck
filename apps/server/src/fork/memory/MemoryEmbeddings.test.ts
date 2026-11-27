import { describe, expect, it } from "@effect/vitest";
import { InferenceServerId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../../serverSettings.ts";
import * as MemoryEmbeddings from "./MemoryEmbeddings.ts";
import * as MemoryStore from "./MemoryStore.ts";
import { layerMemoryTest, threads } from "./memory.testkit.ts";

const SERVER = InferenceServerId.make("local");

// Each word votes for one concept, so a paraphrase lands near the item it means.
const CONCEPTS: ReadonlyArray<ReadonlyArray<string>> = [
  ["pnpm", "npm", "yarn", "package", "packages", "dependencies", "dependency", "install"],
  ["test", "tests", "vitest", "spec", "coverage"],
  ["deploy", "release", "ship", "production"],
];

const embed = (text: string) => {
  const vector = CONCEPTS.map(() => 0.01);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    CONCEPTS.forEach((words, index) => {
      if (words.includes(word)) vector[index]! += 1;
    });
  }
  return vector;
};

interface Recorded {
  readonly url: string;
  readonly model: string;
  readonly input: ReadonlyArray<string>;
}

const fakeServer = (calls: Array<Recorded>, answer: "ok" | "down" = "ok") =>
  HttpClient.make((request) => {
    const body =
      request.body._tag === "Uint8Array"
        ? (JSON.parse(new TextDecoder().decode(request.body.body)) as {
            model: string;
            input: Array<string>;
          })
        : { model: "", input: [] };
    calls.push({ url: request.url, ...body });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        answer === "down"
          ? new Response("bad gateway", { status: 502 })
          : Response.json({
              data: body.input.map((text, index) => ({ index, embedding: embed(text) })),
            }),
      ),
    );
  });

const settings = (baseUrl = "http://127.0.0.1:1234/v1") => ({
  inferenceServers: { [SERVER]: { baseUrl, apiKey: "", enabled: true } },
  cmdeck: { memoryEmbedder: { serverId: SERVER, model: "nomic-embed" } },
});

const seed = Effect.gen(function* () {
  const store = yield* MemoryStore.MemoryStore;
  const context = yield* store.threadContext(threads.main);
  for (const content of [
    "Use pnpm, not npm",
    "Run vitest before pushing",
    "Release from the main branch only",
  ]) {
    yield* store.remember({ context, scope: "global", kind: "fact", content, actor: "user" });
  }
  return { store, context };
});

const PARAPHRASE = "How should I add a dependency here?";

describe("memory search without an embedder", () => {
  const calls: Array<Recorded> = [];
  it.layer(layerMemoryTest({ memoryEnabled: true, embedder: fakeServer(calls) }))((it) => {
    it.effect("uses keywords only and makes no request", () =>
      Effect.gen(function* () {
        const { store, context } = yield* seed;
        expect(yield* store.search({ context, query: PARAPHRASE, limit: 5 })).toEqual([]);
        const found = yield* store.search({ context, query: "pnpm please", limit: 5 });
        expect(found.map((item) => item.content)).toEqual(["Use pnpm, not npm"]);
        expect(calls).toEqual([]);
        const status = yield* MemoryEmbeddings.MemoryEmbeddings.pipe(
          Effect.flatMap((service) => service.status),
        );
        expect(status).toMatchObject({ mode: "keyword", embedder: null, total: 3 });
      }),
    );
  });
});

describe("memory search with a local embedder", () => {
  const calls: Array<Recorded> = [];
  it.layer(
    layerMemoryTest({ memoryEnabled: true, settings: settings(), embedder: fakeServer(calls) }),
  )((it) => {
    it.effect("finds a paraphrase, and re-embeds everything when the model changes", () =>
      Effect.gen(function* () {
        const { store, context } = yield* seed;
        const found = yield* store.search({ context, query: PARAPHRASE, limit: 5 });
        expect(found.map((item) => item.content)).toEqual(["Use pnpm, not npm"]);
        // One request carries the query and every item still missing a vector.
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe("http://127.0.0.1:1234/v1/embeddings");
        expect(calls[0]!.input).toHaveLength(4);
        const embeddings = yield* MemoryEmbeddings.MemoryEmbeddings;
        expect(yield* embeddings.status).toMatchObject({ mode: "hybrid", embedded: 3, total: 3 });

        yield* store.search({ context, query: "tests", limit: 5 });
        expect(calls[1]!.input).toEqual(["tests"]);

        const settingsService = yield* ServerSettings.ServerSettingsService;
        yield* settingsService.updateSettings({
          cmdeck: { memoryEmbedder: { serverId: SERVER, model: "bge-small" } },
        });
        expect(yield* embeddings.status).toMatchObject({ embedded: 0, total: 3 });
        yield* store.search({ context, query: PARAPHRASE, limit: 5 });
        expect(calls[2]!.model).toBe("bge-small");
        expect(calls[2]!.input).toHaveLength(4);
        expect(yield* embeddings.status).toMatchObject({ embedded: 3, total: 3 });

        // An edit drops the old vector, so the item is embedded again with its new text.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE memory_items SET content = 'Use bun' WHERE content = 'Use pnpm, not npm'`;
        expect(yield* embeddings.status).toMatchObject({ embedded: 2, total: 3 });
      }),
    );
  });
});

describe("memory search when the embedder fails", () => {
  const calls: Array<Recorded> = [];
  it.layer(
    layerMemoryTest({
      memoryEnabled: true,
      settings: settings(),
      embedder: fakeServer(calls, "down"),
    }),
  )((it) => {
    it.effect("falls back to keywords, says why, and waits before asking again", () =>
      Effect.gen(function* () {
        const { store, context } = yield* seed;
        const found = yield* store.search({ context, query: "pnpm please", limit: 5 });
        expect(found.map((item) => item.content)).toEqual(["Use pnpm, not npm"]);
        const embeddings = yield* MemoryEmbeddings.MemoryEmbeddings;
        const status = yield* embeddings.status;
        expect(status.mode).toBe("unavailable");
        expect(status.message).toContain("502");
        expect(status.checkedAt).not.toBeNull();

        yield* store.search({ context, query: "pnpm again", limit: 5 });
        expect(calls).toHaveLength(1);
        yield* TestClock.adjust("61 seconds");
        yield* store.search({ context, query: "pnpm again", limit: 5 });
        expect(calls).toHaveLength(2);
      }),
    );
  });
});

describe("an embedder outside the local network", () => {
  const calls: Array<Recorded> = [];
  it.layer(
    layerMemoryTest({
      memoryEnabled: true,
      settings: settings("https://api.example.com/v1"),
      embedder: fakeServer(calls),
    }),
  )((it) => {
    it.effect("is never sent memory", () =>
      Effect.gen(function* () {
        const { store, context } = yield* seed;
        yield* store.search({ context, query: "pnpm please", limit: 5 });
        const embeddings = yield* MemoryEmbeddings.MemoryEmbeddings;
        expect(yield* embeddings.backfill).toBe(0);
        expect(calls).toEqual([]);
        expect((yield* embeddings.status).mode).toBe("unavailable");
      }),
    );
  });
});

describe("backfill", () => {
  const calls: Array<Recorded> = [];
  it.layer(
    layerMemoryTest({ memoryEnabled: true, settings: settings(), embedder: fakeServer(calls) }),
  )((it) => {
    it.effect("embeds every active item in batches", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const context = yield* store.threadContext(threads.main);
        for (let index = 0; index < 40; index++) {
          yield* store.remember({
            context,
            scope: "global",
            kind: "fact",
            content: `Fact number ${index}`,
            actor: "user",
          });
        }
        const embeddings = yield* MemoryEmbeddings.MemoryEmbeddings;
        expect(yield* embeddings.backfill).toBe(40);
        expect(calls.map((call) => call.input.length)).toEqual([32, 8]);
        expect(yield* embeddings.status).toMatchObject({ embedded: 40, total: 40 });
        expect(yield* embeddings.backfill).toBe(0);
      }),
    );
  });
});
