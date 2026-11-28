import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { InferenceServerId, ProjectId } from "@t3tools/contracts";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import { McpServer } from "effect/ai";
import { HttpClient, HttpClientResponse } from "effect/http";

import { asAgentIn, threads } from "../memory/memory.testkit.ts";
import { chunkText } from "./chunker.ts";
import { refusalFor } from "./files.ts";
import { parseIgnore } from "./ignore.ts";
import { Knowledge } from "./Knowledge.ts";
import { layerKnowledgeTest, layerKnowledgeToolsTest } from "./knowledge.testkit.ts";
import { renderHits } from "./mcpTools.ts";

const PROJECT = ProjectId.make("project-app");

/** A temporary folder with `files` written into `<root>/library`, and helpers to change it. */
const makeLibrary = Effect.fn("makeLibrary")(function* (
  files: Record<string, string | Uint8Array>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-knowledge-" });
  const library = path.join(root, "library");
  const write = Effect.fn("write")(function* (relPath: string, content: string | Uint8Array) {
    const file = path.join(library, relPath);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* typeof content === "string"
      ? fs.writeFileString(file, content)
      : fs.writeFile(file, content);
  });
  for (const [relPath, content] of Object.entries(files)) yield* write(relPath, content);
  return { root, library, write, path, fs };
});

/** Adds the source, waits out the run it starts, then indexes once more in this fiber. */
const addAndIndex = Effect.fn("addAndIndex")(function* (library: string) {
  const knowledge = yield* Knowledge;
  const source = yield* knowledge.addSource({ projectId: PROJECT, kind: "folder", path: library });
  yield* knowledge.cancel(source.id);
  yield* knowledge.indexNow(source.id);
  return source.id;
});

const indexedPaths = (sourceId: string) =>
  SqlClient.SqlClient.pipe(
    Effect.flatMap(
      (sql) => sql<{ readonly relPath: string }>`SELECT rel_path AS "relPath" FROM knowledge_files
        WHERE source_id = ${sourceId} AND hash != '' ORDER BY rel_path`,
    ),
    Effect.map((rows) => rows.map((row) => row.relPath)),
  );

describe("knowledge indexer", () => {
  it.effect("re-indexes only changed files and drops deleted ones", () =>
    Effect.gen(function* () {
      const { root, library, write, path, fs } = yield* makeLibrary({
        "alpha.md": "# Alpha\n\nDeploys go through the release train.",
        "beta.md": "Beta notes about caching.",
        "gamma.md": "Gamma will be deleted.",
      });
      yield* Effect.gen(function* () {
        const knowledge = yield* Knowledge;
        const sourceId = yield* addAndIndex(library);
        expect(yield* indexedPaths(sourceId)).toEqual(["alpha.md", "beta.md", "gamma.md"]);
        expect(yield* knowledge.indexNow(sourceId)).toEqual({
          indexed: 0,
          unchanged: 3,
          removed: 0,
        });

        yield* write("beta.md", "Beta now covers the cache eviction policy.");
        // Touched with a new mtime but the same bytes: the hash keeps its chunks.
        const later = 4_102_444_800; // 2100-01-01, in seconds
        yield* fs.utimes(path.join(library, "alpha.md"), later, later);
        yield* fs.utimes(path.join(library, "beta.md"), later, later);
        yield* fs.remove(path.join(library, "gamma.md"));

        expect(yield* knowledge.indexNow(sourceId)).toEqual({
          indexed: 1,
          unchanged: 1,
          removed: 1,
        });
        expect(yield* indexedPaths(sourceId)).toEqual(["alpha.md", "beta.md"]);
        expect(yield* knowledge.search({ projectId: PROJECT, query: "gamma", limit: 5 })).toEqual(
          [],
        );
        const hits = yield* knowledge.search({ projectId: PROJECT, query: "eviction", limit: 5 });
        expect(hits.map((hit) => path.basename(hit.path))).toEqual(["beta.md"]);
        expect(hits[0]!.path).toContain(path.join("library", "beta.md"));
        expect(hits[0]!.lineStart).toBe(1);
      }).pipe(Effect.provide(layerKnowledgeTest({ root })));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("respects .gitignore, the default excludes and skips binaries", () =>
    Effect.gen(function* () {
      const { root, library } = yield* makeLibrary({
        ".gitignore": "drafts/\n*.log\n!.env\n!id_rsa\n",
        "notes/ok.md": "Keep me.",
        "drafts/wip.md": "Ignored by .gitignore.",
        "app.log": "Ignored by .gitignore.",
        ".env": "TOKEN=1",
        ".env.local": "TOKEN=2",
        "server.pem": "-----BEGIN-----",
        id_rsa: "private key",
        "deploy.key": "key",
        "cert.p12": "p12",
        "my-credentials.txt": "user:pass",
        "vault.kdbx": "kdbx",
        "bitwarden_export.json": "{}",
        ".ssh/config": "Host *",
        ".aws/config": "[default]",
        "node_modules/pkg/readme.md": "vendored",
        "image.bin": new Uint8Array([1, 0, 2, 3]),
      });
      yield* Effect.gen(function* () {
        const knowledge = yield* Knowledge;
        const sourceId = yield* addAndIndex(library);
        expect(yield* indexedPaths(sourceId)).toEqual([".gitignore", "notes/ok.md"]);
        const [source] = yield* knowledge.list(PROJECT);
        expect(source).toMatchObject({ state: "ready", files: 3, skipped: 1 });
      }).pipe(Effect.provide(layerKnowledgeTest({ root })));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect.skipIf(!symlinksSupported)("never follows a symlink out of the source", () =>
    Effect.gen(function* () {
      const { root, library, path, fs } = yield* makeLibrary({ "inside.md": "inside" });
      yield* fs.makeDirectory(path.join(root, "outside"));
      yield* fs.writeFileString(path.join(root, "outside", "secret.md"), "outside");
      yield* fs.symlink(path.join(root, "outside"), path.join(library, "linked"));
      yield* fs.symlink(path.join(root, "outside", "secret.md"), path.join(library, "file.md"));
      yield* Effect.gen(function* () {
        expect(yield* indexedPaths(yield* addAndIndex(library))).toEqual(["inside.md"]);
      }).pipe(Effect.provide(layerKnowledgeTest({ root })));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("refuses roots, home, secret folders and notes outside the project", () =>
    Effect.gen(function* () {
      const { root, library, path, fs } = yield* makeLibrary({ "a.md": "a" });
      const home = path.join(root, "home", "me");
      const env = { platform: yield* HostProcess.Platform, home };
      expect(refusalFor(env, path.parse(root).root)).toContain("root");
      expect(refusalFor(env, home)).toContain("home folder");
      expect(refusalFor(env, path.join(root, "home"))).toContain("home folder");
      expect(refusalFor(env, path.join(home, ".ssh"))).toContain("never indexed");
      expect(refusalFor(env, path.join(home, "docs"))).toBeNull();
      yield* fs.makeDirectory(path.join(library, ".aws"));
      yield* Effect.gen(function* () {
        const knowledge = yield* Knowledge;
        const refused = (kind: "folder" | "notes", target: string) =>
          knowledge.addSource({ projectId: PROJECT, kind, path: target }).pipe(Effect.flip);
        expect((yield* refused("folder", path.join(library, ".aws"))).message).toContain(
          "never indexed",
        );
        expect((yield* refused("notes", library)).message).toContain("inside the project");
        expect((yield* refused("folder", path.join(library, "missing"))).message).toContain(
          "Nothing exists",
        );
        const notes = yield* knowledge.addSource({
          projectId: PROJECT,
          kind: "notes",
          path: "notes",
        });
        expect(notes.path).toContain(path.join(PROJECT, "notes"));
        expect((yield* refused("notes", "more-notes")).message).toContain("already has");
        yield* knowledge.removeSource(notes.id);
        expect(yield* knowledge.list(PROJECT)).toEqual([]);
      }).pipe(Effect.provide(layerKnowledgeTest({ root })));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

// Each word votes for one concept, so a paraphrase lands near the chunk it means.
const CONCEPTS = [
  ["dependency", "dependencies", "package", "packages", "pnpm", "install"],
  ["deploy", "release", "ship", "production"],
];
const fakeEmbedder = (inputs: Array<string>) =>
  HttpClient.make((request) => {
    const body =
      request.body._tag === "Uint8Array"
        ? (JSON.parse(new TextDecoder().decode(request.body.body)) as { input: Array<string> })
        : { input: [] };
    inputs.push(...body.input);
    const embed = (text: string) =>
      CONCEPTS.map(
        (words) =>
          0.01 +
          (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => words.includes(w)).length,
      );
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          data: body.input.map((text, index) => ({ index, embedding: embed(text) })),
        }),
      ),
    );
  });

describe("knowledge search with the memory embedder", () => {
  it.effect("finds a chunk by meaning with the embedder memory uses", () =>
    Effect.gen(function* () {
      const { root, library } = yield* makeLibrary({
        "setup.md": "Add packages with pnpm install, never npm.",
        "ops.md": "Ship to production from main.",
      });
      const inputs: Array<string> = [];
      const server = InferenceServerId.make("local");
      yield* Effect.gen(function* () {
        const knowledge = yield* Knowledge;
        yield* addAndIndex(library);
        const hits = yield* knowledge.search({
          projectId: PROJECT,
          query: "How do I add a dependency?",
          limit: 1,
        });
        expect(hits.map((hit) => hit.path)).toEqual([expect.stringMatching(/setup\.md$/)]);
        expect(inputs[0]).toBe("How do I add a dependency?");
        expect(inputs).toHaveLength(3);
      }).pipe(
        Effect.provide(
          layerKnowledgeTest({
            root,
            embedder: fakeEmbedder(inputs),
            settings: {
              inferenceServers: {
                [server]: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", enabled: true },
              },
              cmdeck: { memoryEmbedder: { serverId: server, model: "nomic-embed" } },
            },
          }),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});

describe("knowledge_search", () => {
  it.effect("returns fenced, cited excerpts from the caller's project only", () =>
    Effect.gen(function* () {
      const { root, library } = yield* makeLibrary({
        "runbook.md": "Restart the queue worker with `make restart`. Ask $skill and @file nothing.",
      });
      yield* Effect.gen(function* () {
        yield* addAndIndex(library);
        const call = (threadId: (typeof threads)[keyof typeof threads]["id"]) =>
          McpServer.McpServer.pipe(
            Effect.flatMap((server) =>
              server.callTool({ name: "knowledge_search", arguments: { query: "queue worker" } }),
            ),
            asAgentIn(threadId),
          );
        const own = (yield* call(threads.main.id)).structuredContent as {
          results: ReadonlyArray<{ path: string; line: number; excerpt: string }>;
        };
        expect(own.results).toHaveLength(1);
        expect(own.results[0]!.path).toMatch(/runbook\.md$/);
        expect(own.results[0]!.line).toBe(1);
        expect(own.results[0]!.excerpt.startsWith("```text\n")).toBe(true);
        expect(own.results[0]!.excerpt).not.toContain(" $skill");
        expect(own.results[0]!.excerpt).not.toContain(" @file");
        const other = (yield* call(threads.other.id)).structuredContent as {
          results: ReadonlyArray<unknown>;
        };
        expect(other.results).toEqual([]);
      }).pipe(Effect.provide(layerKnowledgeToolsTest({ root })));
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("fences each excerpt past its backticks and caps the whole answer", () => {
    const hits = Array.from({ length: 20 }, (_, index) => ({
      sourceId: "s",
      kind: "folder" as const,
      path: `/docs/${index}.md`,
      lineStart: 1,
      content: "````\n".concat("x".repeat(5_000)),
    }));
    const rendered = renderHits(hits);
    expect(rendered[0]!.excerpt.startsWith("`````text\n")).toBe(true);
    expect(
      rendered.reduce((total, hit) => total + hit.excerpt.length + hit.path.length, 0),
    ).toBeLessThanOrEqual(40_000);
  });
});

describe("ignore rules and chunks", () => {
  it("matches gitignore anchoring, folders and negation", () => {
    const rules = parseIgnore("/top.md\nbuild/\n*.tmp\n!keep.tmp\ndocs/**/draft.md\n");
    expect(rules.ignores("top.md", false)).toBe(true);
    expect(rules.ignores("sub/top.md", false)).toBe(false);
    expect(rules.ignores("a/build/x.md", false)).toBe(true);
    expect(rules.ignores("a/build", false)).toBe(false);
    expect(rules.ignores("x.tmp", false)).toBe(true);
    expect(rules.ignores("keep.tmp", false)).toBe(false);
    expect(rules.ignores("docs/a/b/draft.md", false)).toBe(true);
  });

  it("splits long text into chunks that start on their own lines", () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) =>
      Array.from({ length: 200 }, () => `word${index}`).join(" "),
    );
    const chunks = chunkText(paragraphs.join("\n\n"), 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.lineStart).toBe(1);
    expect(chunks.map((chunk) => chunk.lineStart)).toEqual(
      chunks.map((chunk) => chunk.lineStart).toSorted((left, right) => left - right),
    );
    expect(chunks.at(-1)!.lineStart).toBeGreaterThan(1);
  });
});
