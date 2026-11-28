import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * Deny rules the server applies to every approval a provider asks for, before anyone answers it.
 * Empty lists and `false` mean no rule, and with no rule the policy does nothing.
 */
export const ApprovalPolicyRules = Schema.Struct({
  /**
   * Regular expressions, case-insensitive, matched against a command's text. Not validated here:
   * a typo would reset the whole settings file, so the policy treats a broken pattern as matching.
   */
  denyCommands: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** Tool names, case-insensitive; a trailing `*` matches a prefix such as `mcp__github__*`. */
  denyTools: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /**
   * Paths no request may read or write. `~` is the server user's home. An absolute path covers
   * everything under it; a relative one (`.env`, `.aws/credentials`) matches anywhere.
   */
  protectedPaths: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** Decline file changes outside the thread's working directory. */
  denyWritesOutsideWorkspace: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type ApprovalPolicyRules = typeof ApprovalPolicyRules.Type;
