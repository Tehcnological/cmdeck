import type { DecisionPoint } from "@t3tools/contracts";
import type * as Duration from "effect/Duration";

import type { Answers, Question } from "./questions.ts";

/**
 * One decision point. The rule is deterministic, needs no model and is the answer whenever a model
 * is not configured, has no consent, fails, times out or answers outside its domain.
 */
export interface DecisionPointSpec<I, A> {
  readonly point: DecisionPoint;
  readonly rule: (input: I) => A;
  /** What to ask, or undefined when nothing a model says could change the outcome. */
  readonly ask: (
    input: I,
    ruled: A,
  ) => { readonly state: string; readonly questions: ReadonlyArray<Question> } | undefined;
  /** The answer given the model's valid answers; it holds the point's guarantees whatever they say. */
  readonly combine: (input: I, ruled: A, answers: Answers) => A;
  /** How long a turn or tick waits on the model before it takes the rule. */
  readonly timeout: Duration.Input;
}
