// Ranking ported from openclaw/openclaw@f57a32938b7b4b99e25f9d2343c6890978ba9f7d (MIT): the hybrid
// weights, candidate multiplier and minimum score (src/agents/memory-search.ts), bm25RankToScore
// (extensions/memory-core/src/memory/keyword-query.ts) and the half-life decay (temporal-decay.ts).
import type { MemoryItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MemoryNarrowing from "../decisions/points/memoryNarrowing.ts";

const MAX_QUERY_TERMS = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A fact untouched this long ranks at half the weight of one written today. Nothing is deleted. */
export const FACT_HALF_LIFE_DAYS = 30;
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
/** Each search reads this many times the results it returns from each side before merging. */
export const CANDIDATE_MULTIPLIER = 4;
/** A match by meaning alone must score this before decay; a keyword match always counts. */
const MIN_VECTOR_ONLY_SCORE = 0.35;

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
  Math.exp(-(Math.LN2 / FACT_HALF_LIFE_DAYS) * (Math.max(0, ageMs) / DAY_MS));

/** SQLite's bm25() is negative, lower is better; this maps it into 0..1, higher is better. */
export const bm25RankToScore = (rank: number): number => {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
};

/** Vectors of different lengths come from different models and share no meaning. */
export const cosineSimilarity = (left: Float32Array, right: Float32Array): number => {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm);
};

export interface RankCandidate {
  readonly item: MemoryItem;
  /** SQLite's bm25() when the item matched the keywords. */
  readonly bm25?: number;
  /** Cosine similarity to the query when both were embedded. */
  readonly cosine?: number;
}

/**
 * Best match first. With an embedder, 0.7 meaning plus 0.3 keywords; without one, keywords alone.
 * Facts then decay with age; rules never do. Decay only orders: it never hides an item.
 */
export const rankByRelevance = (
  candidates: ReadonlyArray<RankCandidate>,
  nowMs: number,
  hybrid = false,
): ReadonlyArray<MemoryItem> =>
  candidates
    .flatMap(({ item, bm25, cosine }) => {
      const text = bm25 === undefined ? 0 : bm25RankToScore(bm25);
      const content = hybrid ? VECTOR_WEIGHT * Math.max(0, cosine ?? 0) + TEXT_WEIGHT * text : text;
      if (bm25 === undefined && content < MIN_VECTOR_ONLY_SCORE) return [];
      const decay = item.kind === "rule" ? 1 : decayFactor(nowMs - Date.parse(item.updatedAt));
      return [{ item, score: content * decay }];
    })
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
