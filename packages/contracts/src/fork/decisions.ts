import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderInstanceId } from "../providerInstance.ts";

/** Where the decision service may ask a question. Each has a deterministic rule that also serves as its fallback. */
export const DecisionPoint = Schema.Literals([
  "modelRouting",
  "memoryNarrowing",
  "wakeSuppression",
  "riskAnnotation",
  /** Lessons from a project's chats (WI-2.07); consented one project at a time, which opts it in. */
  "lessons",
]);
export type DecisionPoint = typeof DecisionPoint.Type;

/**
 * What a consent allows a point to ask. `local`: a model API on this machine, the local network or
 * the tailnet. `remote`: any configured model API, granted only per project.
 */
export const DecisionConsentSource = Schema.Literals(["local", "remote"]);
export type DecisionConsentSource = typeof DecisionConsentSource.Type;

export const DecisionConsent = Schema.Struct({
  point: DecisionPoint,
  /** Null covers every project; a remote consent always names one. */
  projectId: Schema.NullOr(ProjectId),
  source: DecisionConsentSource,
  grantedAt: IsoDateTime,
});
export type DecisionConsent = typeof DecisionConsent.Type;

/** A null `source` withdraws the consent. */
export const DecisionConsentSetInput = Schema.Struct({
  point: DecisionPoint,
  projectId: Schema.NullOr(ProjectId),
  source: Schema.NullOr(DecisionConsentSource),
});
export type DecisionConsentSetInput = typeof DecisionConsentSetInput.Type;

/** The text generator the decision service asks, from `cmdeck.decisionModel`. */
export const DecisionModelSetting = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
});
export type DecisionModelSetting = typeof DecisionModelSetting.Type;

export const DecisionsStatus = Schema.Struct({
  model: Schema.NullOr(
    Schema.Struct({
      instanceId: ProviderInstanceId,
      model: TrimmedNonEmptyString,
      /** Whether its address is on this machine, the local network or the tailnet. */
      local: Schema.Boolean,
    }),
  ),
  consents: Schema.Array(DecisionConsent),
});
export type DecisionsStatus = typeof DecisionsStatus.Type;

export class DecisionsError extends Schema.TaggedError<DecisionsError>()("DecisionsError", {
  detail: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
