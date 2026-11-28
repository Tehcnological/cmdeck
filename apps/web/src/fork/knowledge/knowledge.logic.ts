import type { KnowledgeSource } from "@t3tools/contracts";

/** How often the section re-reads status while a source is indexing. */
export const INDEXING_REFRESH_MS = 2_000;

export interface KnowledgeSplit {
  readonly notes: KnowledgeSource | null;
  readonly sources: ReadonlyArray<KnowledgeSource>;
}

/** The project's notes folder apart from its other sources. */
export const splitSources = (all: ReadonlyArray<KnowledgeSource>): KnowledgeSplit => ({
  notes: all.find((source) => source.kind === "notes") ?? null,
  sources: all.filter((source) => source.kind !== "notes"),
});

export const anyIndexing = (all: ReadonlyArray<KnowledgeSource>): boolean =>
  all.some((source) => source.state === "indexing" || source.state === "pending");
