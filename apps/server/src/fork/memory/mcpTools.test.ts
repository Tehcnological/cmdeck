import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { McpServer } from "effect/ai";

import * as MemoryStore from "./MemoryStore.ts";
import { asAgentIn, layerMemoryToolsTest, threads } from "./memory.testkit.ts";

const callTool = (name: string, args: Record<string, unknown>, threadId = threads.main.id) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    asAgentIn(threadId),
  );

const searchContents = (query: string) =>
  callTool("memory_search", { query }).pipe(
    Effect.map((result) =>
      (result.structuredContent as { items: ReadonlyArray<{ content: string }> }).items.map(
        ({ content }) => content,
      ),
    ),
  );

describe("memory MCP tools", () => {
  it.layer(layerMemoryToolsTest({ memoryEnabled: true }))((it) => {
    it.effect("an agent's memory waits for the user, then searches and retires", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const proposed = yield* callTool("memory_remember", {
          content: "Deploys go through scripts/ship.sh",
        });
        const { id, status } = proposed.structuredContent as { id: string; status: string };
        expect(status).toBe("pending");
        expect(yield* searchContents("deploys")).toEqual([]);

        yield* store.accept(id);
        expect(yield* searchContents("deploys")).toEqual(["Deploys go through scripts/ship.sh"]);
        expect((yield* callTool("memory_forget", { id })).isError).toBe(false);
        expect(yield* searchContents("deploys")).toEqual([]);

        // Even in a turn a person started, the agent's write is a proposal.
        const saved = yield* callTool("memory_remember", { content: "Use pnpm", kind: "rule" });
        expect(saved.structuredContent).toMatchObject({ status: "pending" });
      }),
    );

    it.effect("a temporary thread can neither search nor remember", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        yield* store.setThreadMode(threads.other.id, "temporary");
        const search = yield* callTool("memory_search", { query: "pnpm" }, threads.other.id);
        const remember = yield* callTool("memory_remember", { content: "x" }, threads.other.id);
        for (const result of [search, remember]) {
          expect(result.isError).toBe(true);
          expect(JSON.stringify(result.content)).toContain("memory is temporary");
        }
      }),
    );

    it.effect("memory_mode reads the mode and only makes it more private", () =>
      Effect.gen(function* () {
        const mode = (args: Record<string, unknown>) =>
          callTool("memory_mode", args, threads.clone.id).pipe(
            Effect.map((result) => (result.structuredContent as { mode: string }).mode),
          );
        expect(yield* mode({})).toBe("persistent");
        expect(yield* mode({ mode: "temporary" })).toBe("temporary");
        expect(yield* mode({ mode: "incognito" })).toBe("temporary");
        // Making it less private is not a mode the tool accepts; only the user promotes.
        const promote = yield* callTool(
          "memory_mode",
          { mode: "persistent" },
          threads.clone.id,
        ).pipe(Effect.exit);
        expect(promote._tag).toBe("Failure");
        expect(yield* mode({})).toBe("temporary");
      }),
    );
  });
});
