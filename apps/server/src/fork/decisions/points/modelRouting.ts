// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/decisions/points/model_route.py (Apache-2.0):
// tier names and descriptions, the asymmetry sentence and the downgrade bar. Changes: tiers map to
// a scheduled task's model, a refusal keeps the heuristic tier, and usage limits pick the candidate.
import {
  isProviderAvailable,
  type ModelSelection,
  type ProviderInstanceId,
  type RoutingTierModels,
  type ServerProvider,
} from "@t3tools/contracts";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";

import type { DecisionPointSpec } from "../spec.ts";
import { classifyComplexity, type ComplexityTier } from "./complexity.ts";

/** What started the thread. Scheduled and webhook runs are unattended; a workflow step has a person behind it. */
export type AutomationKind = "scheduled" | "webhook" | "workflow";

const UNATTENDED: ReadonlySet<AutomationKind> = new Set(["scheduled", "webhook"]);

/** Unattended runs leave this much of a usage window to the person's own turns. */
const NEAR_LIMIT_PERCENT = 90;

/** A model answer below the heuristic's tier needs this confidence: a turn put too low gets a worse answer. */
const MIN_DOWNGRADE_CONFIDENCE = 0.8;

const TIERS: ReadonlyArray<ComplexityTier> = ["simple", "medium", "complex"];

const TIER_DESCRIPTIONS: Readonly<Record<ComplexityTier, string>> = {
  simple:
    "a short, local, mechanical request answerable in one step -- a rename, a lookup, a small edit, a direct factual question",
  medium:
    "ordinary work over a few files or steps -- write a function, explain some code, fix a bug whose cause is already named",
  complex:
    "work needing a plan, a trade-off or reasoning across a whole system -- design, architecture, a diagnosis with no named cause, a risky refactor",
};

const TIER_ASYMMETRY =
  "Being wrong in the two directions does not cost the same. A turn put in a lower tier than it needs gets less room to work in and a worse answer; a turn put higher only costs more. So answer simple only when the request is self-contained and you can see the whole of it -- a request that is a plan, a judgement call, several instructions at once, or that names work you cannot see, is not simple however short it is.";

const MAX_PROMPT_CHARS = 2_000;

export interface ModelRoutingInput {
  readonly kind: AutomationKind;
  readonly prompt: string;
  readonly requested: ModelSelection;
  readonly tierModels: RoutingTierModels;
  /** The project's fallback model, tried when the others are at their limit. */
  readonly fallback: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** Whether the project allows this provider instance. */
  readonly projectAllows: (instanceId: ProviderInstanceId) => boolean;
  readonly now: number;
}

export interface ModelRoute {
  readonly tier: ComplexityTier;
  readonly selection: ModelSelection;
  /**
   * `requested`: the task's own model. `tier`: the model pinned for the tier. `fallback`: another
   * candidate because the first was unusable or at its limit. `held`: every candidate was, so the
   * task keeps its model and the scheduler's usage hold applies.
   */
  readonly reason: "requested" | "tier" | "fallback" | "held";
}

const sameSelection = (left: ModelSelection, right: ModelSelection) =>
  left.instanceId === right.instanceId && left.model === right.model;

const nearLimit = (provider: ServerProvider, model: string, now: number) =>
  (provider.usageLimits?.windows ?? []).some(
    (window) =>
      (window.usedPercent ?? 0) >= NEAR_LIMIT_PERCENT &&
      (window.modelIds === undefined || window.modelIds.includes(model)) &&
      (!window.resetsAt ||
        !Number.isFinite(Date.parse(window.resetsAt)) ||
        Date.parse(window.resetsAt) > now),
  );

/** The first candidate that can run now, in order: the tier's model, the task's, the project fallback. */
export const route = (input: ModelRoutingInput, tier: ComplexityTier): ModelRoute => {
  const preferred = input.tierModels[tier] ?? input.requested;
  const candidates: Array<ModelSelection> = [];
  for (const candidate of [preferred, input.requested, input.fallback]) {
    if (candidate !== null && !candidates.some((seen) => sameSelection(seen, candidate))) {
      candidates.push(candidate);
    }
  }
  const open = (selection: ModelSelection) => {
    const provider = input.providers.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    return (
      provider !== undefined &&
      provider.enabled &&
      provider.installed &&
      provider.auth.status !== "unauthenticated" &&
      isProviderAvailable(provider) &&
      input.projectAllows(selection.instanceId) &&
      exhaustedUsageWindow(provider, input.now, selection.model) === undefined &&
      !(UNATTENDED.has(input.kind) && nearLimit(provider, selection.model, input.now))
    );
  };
  const chosen = candidates.find(open);
  if (chosen === undefined) return { tier, selection: input.requested, reason: "held" };
  return {
    tier,
    selection: chosen,
    reason: sameSelection(chosen, preferred)
      ? sameSelection(chosen, input.requested)
        ? "requested"
        : "tier"
      : sameSelection(chosen, input.requested)
        ? "requested"
        : "fallback",
  };
};

export const modelRouting: DecisionPointSpec<ModelRoutingInput, ModelRoute> = {
  point: "modelRouting",
  rule: (input) => route(input, classifyComplexity(input.prompt).tier),
  // With no tier pinned every tier routes alike, so there is nothing to ask.
  ask: (input) =>
    Object.keys(input.tierModels).length === 0
      ? undefined
      : {
          state: `Task kind: ${input.kind}\nRequest:\n${input.prompt.slice(0, MAX_PROMPT_CHARS)}`,
          questions: [
            {
              kind: "choice",
              id: "tier",
              prompt: `How hard is this request for an AI coding assistant? ${TIER_ASYMMETRY}`,
              options: TIERS,
              criteria: TIER_DESCRIPTIONS,
            },
          ],
        },
  combine: (input, ruled, answers) => {
    const answer = answers.get("tier");
    const tier = TIERS.find((candidate) => candidate === answer?.value);
    if (answer === undefined || tier === undefined) return ruled;
    if (
      TIERS.indexOf(tier) < TIERS.indexOf(ruled.tier) &&
      answer.confidence < MIN_DOWNGRADE_CONFIDENCE
    ) {
      return ruled;
    }
    return route(input, tier);
  },
  timeout: "10 seconds",
};
