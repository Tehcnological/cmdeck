import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ModelSelection } from "../modelSelection.ts";
import { DecisionModelSetting } from "./decisions.ts";

/** Models a scheduled task's new thread runs on for each routing tier; an unset tier keeps the task's model. */
export const RoutingTierModels = Schema.Struct({
  simple: Schema.optionalKey(ModelSelection),
  medium: Schema.optionalKey(ModelSelection),
  complex: Schema.optionalKey(ModelSelection),
});
export type RoutingTierModels = typeof RoutingTierModels.Type;

/** One usage alert threshold, in percent of a limit window used. */
export const UsageAlertPercent = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

/**
 * Fork-only server settings, kept under one `cmdeck` key that upstream clients ignore. Each module
 * adds a field whose decoding default leaves the module off.
 */
export const CmdeckSettings = Schema.Struct({
  /** Memory injects nothing, lists no items and keeps no turn records while this is off. */
  memoryEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** The text generator decision points ask once a point has consent; null keeps every point on its rule. */
  decisionModel: Schema.NullOr(DecisionModelSetting).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  routingTierModels: RoutingTierModels.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /**
   * Usage alerts fire when a limit window passes one of these; empty turns them off. Without an
   * enabled notification channel nothing is sent, so the default stays inert.
   */
  usageAlertPercents: Schema.Array(UsageAlertPercent).pipe(
    Schema.withDecodingDefault(Effect.succeed([80])),
  ),
});

export const CmdeckSettingsPatch = Schema.Struct({
  memoryEnabled: Schema.optionalKey(Schema.Boolean),
  decisionModel: Schema.optionalKey(Schema.NullOr(DecisionModelSetting)),
  routingTierModels: Schema.optionalKey(RoutingTierModels),
  usageAlertPercents: Schema.optionalKey(Schema.Array(UsageAlertPercent)),
});
