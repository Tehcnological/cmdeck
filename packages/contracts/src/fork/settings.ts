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
});

export const CmdeckSettingsPatch = Schema.Struct({
  memoryEnabled: Schema.optionalKey(Schema.Boolean),
  decisionModel: Schema.optionalKey(Schema.NullOr(DecisionModelSetting)),
  routingTierModels: Schema.optionalKey(RoutingTierModels),
});
