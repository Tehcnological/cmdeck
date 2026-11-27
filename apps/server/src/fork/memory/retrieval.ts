import type { MemoryItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MemoryNarrowing from "../decisions/points/memoryNarrowing.ts";

const MAX_QUERY_TERMS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A fact untouched this long ranks at half the weight of one written today. Nothing is deleted. */
export const FACT_HALF_LIFE_DAYS = 90;

/** An FTS5 query matching any word of the text, or null when it has none worth matching. */
export const ftsQuery = (text: string): string | null => {
  const terms = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}_]{3,}/gu)) {
    terms.add(match[0]);
    if (terms.size === MAX_QUERY_TERMS) break;
  }
  return terms.size === 0 ? null : [...terms].map((term) => `"${term}"`).join(" OR ");
};

export const decayFactor = (ageMs: number): number =>
  0.5 ** (Math.max(0, ageMs) / DAY_MS / FACT_HALF_LIFE_DAYS);

export interface RankCandidate {
  readonly item: MemoryItem;
  /** SQLite's bm25(): lower is a better match. */
  readonly bm25: number;
}

/** Best match first: BM25 relevance times decay. Decay only orders; it never hides an item. */
export const rankByRelevance = (
  candidates: ReadonlyArray<RankCandidate>,
  nowMs: number,
): ReadonlyArray<MemoryItem> =>
  candidates
    .map(({ item, bm25 }) => ({
      item,
      score: -bm25 * decayFactor(nowMs - Date.parse(item.updatedAt)),
    }))
    .toSorted((left, right) => right.score - left.score)
    .map(({ item }) => item);

export type FactNarrower = (
  input: MemoryNarrowing.MemoryNarrowingInput,
) => Effect.Effect<ReadonlyArray<MemoryItem>>;

/** Steps between ranking and injection, resolved once when turn context starts. Append new ones. */
const FACT_NARROWERS: ReadonlyArray<Effect.Effect<FactNarrower>> = [MemoryNarrowing.narrower];

/** Runs every narrower in order. Each may only drop facts: none can add one or reorder them. */
export const factNarrowing: Effect.Effect<FactNarrower> = Effect.all(FACT_NARROWERS).pipe(
  Effect.map(
    (narrowers): FactNarrower =>
      (input) =>
        Effect.reduce(
          narrowers,
          () => input.facts,
          (facts, narrow) =>
            narrow({ ...input, facts }).pipe(
              Effect.map((kept) => {
                const ids = new Set(kept.map((item) => item.id));
                return facts.filter((item) => ids.has(item.id));
              }),
            ),
        ),
  ),
);
