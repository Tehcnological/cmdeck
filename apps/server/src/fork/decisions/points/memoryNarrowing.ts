// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/decisions/points/memory_recall.py (Apache-2.0):
// the keep/drop question, its threshold and the judged-candidate cap. Changes: candidates are
// ranked memory facts, and an answer may only drop a fact.
import type { MemoryItem, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Decisions } from "../Decisions.ts";
import type { DecisionPointSpec } from "../spec.ts";

/** Keep confidence at or above which a fact stays. The meaning of the answer, not a setting. */
const KEEP_THRESHOLD = 0.5;

/** Facts past this many are kept unjudged, so a long list never costs a long wait. */
const MAX_CANDIDATES = 8;

const MAX_MESSAGE_CHARS = 2_000;
const MAX_SNIPPET_CHARS = 200;

export interface MemoryNarrowingInput {
  readonly projectId: ProjectId | null;
  readonly text: string;
  /** Already ranked and limited, best first. */
  readonly facts: ReadonlyArray<MemoryItem>;
}

const questionId = (index: number) => `memory_${index}`;

export const memoryNarrowing: DecisionPointSpec<MemoryNarrowingInput, ReadonlyArray<MemoryItem>> = {
  point: "memoryNarrowing",
  // Without a model every ranked fact reaches the turn, as before the decision service.
  rule: (input) => input.facts,
  ask: (input) => {
    const judged = input.facts.slice(0, MAX_CANDIDATES);
    if (judged.length === 0) return undefined;
    return {
      state: [
        `Message:\n${input.text.slice(0, MAX_MESSAGE_CHARS)}`,
        ...judged.map(
          (fact, index) => `Memory ${index + 1}: ${fact.content.slice(0, MAX_SNIPPET_CHARS)}`,
        ),
      ].join("\n"),
      questions: judged.map((_, index) => ({
        kind: "choice" as const,
        id: questionId(index),
        prompt: `Memory ${index + 1} is offered to this turn's prompt. Answer keep if it helps with this message, drop if it is not worth its place in the prompt.`,
        options: ["keep", "drop"],
      })),
    };
  },
  combine: (input, ruled, answers) =>
    ruled.filter((_, index) => {
      const answer = index < MAX_CANDIDATES ? answers.get(questionId(index)) : undefined;
      if (answer === undefined) return true;
      const keep = answer.value === "keep" ? answer.confidence : 1 - answer.confidence;
      return keep >= KEEP_THRESHOLD;
    }),
  timeout: "5 seconds",
};

/** Registered in memory retrieval; without the decision service it keeps every fact. */
export const narrower = Effect.serviceOption(Decisions).pipe(
  Effect.map(
    Option.match({
      onNone: () => (input: MemoryNarrowingInput) => Effect.succeed(input.facts),
      onSome: (decisions) => (input: MemoryNarrowingInput) =>
        decisions
          .decide(memoryNarrowing, input, { projectId: input.projectId })
          .pipe(Effect.map((decided) => decided.value)),
    }),
  ),
);
