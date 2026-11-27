import * as Schema from "effect/Schema";

/**
 * Fork-only server settings, kept under one `cmdeck` key that upstream clients ignore. Each module
 * adds a field whose decoding default leaves the module off.
 */
export const CmdeckSettings = Schema.Struct({});

export const CmdeckSettingsPatch = Schema.Struct({});
