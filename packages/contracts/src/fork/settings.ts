import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Fork-only server settings, kept under one `cmdeck` key that upstream clients ignore. Each module
 * adds a field whose decoding default leaves the module off.
 */
export const CmdeckSettings = Schema.Struct({
  /** Memory injects nothing, lists no items and keeps no turn records while this is off. */
  memoryEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});

export const CmdeckSettingsPatch = Schema.Struct({
  memoryEnabled: Schema.optionalKey(Schema.Boolean),
});
