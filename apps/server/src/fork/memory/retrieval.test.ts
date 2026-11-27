import type { MemoryItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { decayFactor, FACT_HALF_LIFE_DAYS, ftsQuery, rankByRelevance } from "./retrieval.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T00:00:00.000Z");
const item = (id: string, daysOld: number): MemoryItem => {
  const at = DateTime.formatIso(DateTime.makeUnsafe(NOW - daysOld * DAY_MS));
  return {
    id,
    scope: "global",
    kind: "fact",
    content: id,
    provenance: "user_explicit",
    status: "active",
    originThreadId: null,
    createdAt: at,
    updatedAt: at,
  };
};

describe("ftsQuery", () => {
  it("quotes each word of three or more characters, so FTS syntax in the text is inert", () => {
    expect(ftsQuery('Use "pnpm" OR npm* in the CI-pipeline')).toBe(
      '"use" OR "pnpm" OR "npm" OR "the" OR "pipeline"',
    );
    expect(ftsQuery("ok?")).toBeNull();
  });
});

describe("rankByRelevance", () => {
  it("halves a fact's weight every half-life and never drops it", () => {
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(FACT_HALF_LIFE_DAYS * DAY_MS)).toBeCloseTo(0.5);
    expect(decayFactor(10 * FACT_HALF_LIFE_DAYS * DAY_MS)).toBeGreaterThan(0);
  });

  it("orders by BM25 relevance times decay", () => {
    const ranked = rankByRelevance(
      [
        { item: item("weak-new", 0), bm25: -1 },
        { item: item("strong-old", 2 * FACT_HALF_LIFE_DAYS), bm25: -6 },
        { item: item("strong-new", 1), bm25: -5 },
        { item: item("strong-ancient", 5 * FACT_HALF_LIFE_DAYS), bm25: -8 },
      ],
      NOW,
    );
    expect(ranked.map(({ id }) => id)).toEqual([
      "strong-new",
      "strong-old",
      "weak-new",
      "strong-ancient",
    ]);
  });
});
