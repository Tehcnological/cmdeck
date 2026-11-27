// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/decisions/points/nudge_wake.py (Apache-2.0):
// the wake/quiet question and "every refusal spends the turn". Changes: one question instead of
// three, and an answer can only delay a tick.
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Decisions } from "../Decisions.ts";
import type { DecisionPointSpec } from "../spec.ts";

/** Confidence a "quiet" answer needs; an unsure model hands the tick to the thread. */
const QUIET_MIN_CONFIDENCE = 0.8;

const MAX_EVIDENCE_CHARS = 4_000;

export interface WakeInput {
  readonly projectId: ProjectId | null;
  /** What the loop watches, in the owner's words. */
  readonly instruction: string;
  /** What changed since the last tick. */
  readonly evidence: string;
  /** A check failed or errored this tick; always wakes. */
  readonly failing: boolean;
  /** The watch is about to end (budget, expiry, sentinel); always wakes. */
  readonly ending: boolean;
}

/** A model can delay a tick. It can never end a watch or swallow a failure. */
export type WakeDecision = "wake" | "delay";

export const wakeSuppression: DecisionPointSpec<WakeInput, WakeDecision> = {
  point: "wakeSuppression",
  rule: () => "wake",
  ask: (input) =>
    input.failing || input.ending
      ? undefined
      : {
          state: `What the owner watches for:\n${input.instruction}\n\nWhat changed:\n${input.evidence.slice(0, MAX_EVIDENCE_CHARS)}`,
          questions: [
            {
              kind: "choice",
              id: "needs_owner",
              prompt:
                "Does the owning thread need to act on this tick? Answer wake if anything here needs it, quiet only if nothing new does.",
              options: ["wake", "quiet"],
            },
          ],
        },
  combine: (input, ruled, answers) => {
    if (input.failing || input.ending) return "wake";
    const answer = answers.get("needs_owner");
    return answer?.value === "quiet" && answer.confidence >= QUIET_MIN_CONFIDENCE ? "delay" : ruled;
  },
  timeout: "10 seconds",
};

/** WI-2.12's call site for monitor loops. Without the decision service every tick wakes. */
export const decideWake = (input: WakeInput): Effect.Effect<WakeDecision> =>
  Effect.serviceOption(Decisions).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<WakeDecision>("wake"),
        onSome: (decisions) =>
          decisions
            .decide(wakeSuppression, input, { projectId: input.projectId })
            .pipe(Effect.map((decided) => decided.value)),
      }),
    ),
  );
