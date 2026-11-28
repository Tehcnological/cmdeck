import type { MemoryItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  bm25RankToScore,
  cosineSimilarity,
  decayFactor,
  FACT_HALF_LIFE_DAYS,
  ftsQuery,
  type RankCandidate,
  rankByRelevance,
} from "./retrieval.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-26T00:00:00.000Z");
const item = (id: string, daysOld: number, kind: MemoryItem["kind"] = "fact"): MemoryItem => {
  const at = DateTime.formatIso(DateTime.makeUnsafe(NOW - daysOld * DAY_MS));
  return {
    id,
    scope: "global",
    kind,
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

describe("scores", () => {
  it("maps SQLite's negative bm25 into 0..1, stronger matches higher", () => {
    expect(bm25RankToScore(-9)).toBeCloseTo(0.9);
    expect(bm25RankToScore(-1)).toBeCloseTo(0.5);
    expect(bm25RankToScore(-9)).toBeGreaterThan(bm25RankToScore(-1));
    expect(bm25RankToScore(Number.NaN)).toBeCloseTo(0.001);
  });

  it("compares vectors only of one length", () => {
    expect(cosineSimilarity(Float32Array.of(1, 0), Float32Array.of(2, 0))).toBeCloseTo(1);
    expect(cosineSimilarity(Float32Array.of(1, 0), Float32Array.of(0, 1))).toBe(0);
    expect(cosineSimilarity(Float32Array.of(1, 0), Float32Array.of(1, 0, 0))).toBe(0);
    expect(cosineSimilarity(Float32Array.of(0, 0), Float32Array.of(1, 0))).toBe(0);
  });

  it("halves a fact's weight every half-life and never reaches zero", () => {
    expect(FACT_HALF_LIFE_DAYS).toBe(30);
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(FACT_HALF_LIFE_DAYS * DAY_MS)).toBeCloseTo(0.5);
    expect(decayFactor(10 * FACT_HALF_LIFE_DAYS * DAY_MS)).toBeGreaterThan(0);
    expect(decayFactor(-DAY_MS)).toBe(1);
  });
});

describe("rankByRelevance", () => {
  const rank = (candidates: ReadonlyArray<RankCandidate>, hybrid: boolean) =>
    rankByRelevance(candidates, NOW, hybrid).map(({ id }) => id);

  it.each<{
    name: string;
    hybrid: boolean;
    candidates: ReadonlyArray<RankCandidate>;
    expected: ReadonlyArray<string>;
  }>([
    {
      name: "keywords only: bm25 times decay",
      hybrid: false,
      candidates: [
        { item: item("weak-new", 0), bm25: -1 },
        { item: item("strong-month", 30), bm25: -6 },
        { item: item("strong-new", 1), bm25: -5 },
        { item: item("strong-ancient", 150), bm25: -8 },
      ],
      expected: ["strong-new", "weak-new", "strong-month", "strong-ancient"],
    },
    {
      name: "keywords only: a vector score is ignored",
      hybrid: false,
      candidates: [
        { item: item("keyword", 0), bm25: -2 },
        { item: item("meaning", 0), cosine: 0.99 },
      ],
      expected: ["keyword"],
    },
    {
      name: "hybrid: meaning outweighs a keyword hit",
      hybrid: true,
      candidates: [
        { item: item("keyword", 0), bm25: -4 },
        { item: item("meaning", 0), cosine: 0.9 },
        { item: item("both", 0), bm25: -4, cosine: 0.9 },
      ],
      expected: ["both", "meaning", "keyword"],
    },
    {
      name: "hybrid: a weak match by meaning alone is dropped, a weak keyword match is kept",
      hybrid: true,
      candidates: [
        { item: item("unrelated", 0), cosine: 0.4 },
        { item: item("weak-keyword", 0), bm25: -0.2, cosine: 0.1 },
      ],
      expected: ["weak-keyword"],
    },
    {
      name: "hybrid: decay orders an old fact below a new one",
      hybrid: true,
      candidates: [
        { item: item("old", 90), bm25: -4, cosine: 0.95 },
        { item: item("new", 0), bm25: -1, cosine: 0.7 },
      ],
      expected: ["new", "old"],
    },
    {
      name: "hybrid: rules never decay",
      hybrid: true,
      candidates: [
        { item: item("old-rule", 365, "rule"), cosine: 0.9 },
        { item: item("new-fact", 0), cosine: 0.8 },
      ],
      expected: ["old-rule", "new-fact"],
    },
    {
      name: "a negative cosine counts as no match by meaning",
      hybrid: true,
      candidates: [
        { item: item("opposite", 0), bm25: -1, cosine: -0.9 },
        { item: item("neutral", 0), bm25: -1, cosine: 0 },
      ],
      expected: ["opposite", "neutral"],
    },
  ])("$name", ({ candidates, hybrid, expected }) => {
    expect(rank(candidates, hybrid)).toEqual(expected);
  });
});
