import { type KnowledgeSource, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { anyIndexing, splitSources } from "./knowledge.logic";

const source = (overrides: Partial<KnowledgeSource>): KnowledgeSource => ({
  id: "s",
  projectId: ProjectId.make("p"),
  kind: "folder",
  path: "/docs",
  state: "ready",
  files: 1,
  chunks: 1,
  skipped: 0,
  indexedAt: "2026-11-28T00:00:00.000Z",
  message: null,
  ...overrides,
});

describe("knowledge section logic", () => {
  it("keeps the notes folder apart from other sources", () => {
    const notes = source({ id: "n", kind: "notes" });
    const docs = source({ id: "d" });
    expect(splitSources([docs, notes])).toEqual({ notes, sources: [docs] });
    expect(splitSources([docs])).toEqual({ notes: null, sources: [docs] });
  });

  it("refreshes only while a source is waiting or indexing", () => {
    expect(anyIndexing([source({})])).toBe(false);
    expect(anyIndexing([source({}), source({ state: "indexing" })])).toBe(true);
    expect(anyIndexing([source({ state: "pending" })])).toBe(true);
    expect(anyIndexing([source({ state: "error" })])).toBe(false);
  });
});
