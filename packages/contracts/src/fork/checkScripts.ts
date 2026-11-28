// Limits and exit-code contract ported from MarlBurroW/sillage@14483e3 packages/protocol/src/schedules.ts (MIT).
import * as Schema from "effect/Schema";

import { ScheduledTaskId } from "../baseSchemas.ts";

/**
 * A check script decides whether a scheduled run wakes the agent: exit 0 wakes it with the output,
 * this code skips the run without a turn, and any other code is a failure. A dedicated code rather
 * than 1, since crashes commonly exit 1 and must not look like "nothing new".
 */
export const CHECK_SKIP_EXIT_CODE = 10;
export const MAX_CHECK_SCRIPT_CHARS = 20_000;
export const MIN_CHECK_TIMEOUT_SECONDS = 5;
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 120;
export const MAX_CHECK_TIMEOUT_SECONDS = 1800;
/** The most of a check's stdout a turn or a notification receives. */
export const MAX_CHECK_OUTPUT_CHARS = 20_000;

/** The run's last error while a script waits for a person; clients match it to offer review. */
export const CHECK_NEEDS_APPROVAL =
  "Check script needs approval: it is new or changed, so nothing runs until you approve it.";

export const CheckInterpreter = Schema.Literals(["node", "bash", "pwsh"]);
export type CheckInterpreter = typeof CheckInterpreter.Type;

export const ScheduledTaskCheck = Schema.Struct({
  interpreter: CheckInterpreter.annotate({
    description: "Reads the script on stdin. bash is Git Bash on Windows.",
  }),
  script: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_CHECK_SCRIPT_CHARS)),
  timeoutSeconds: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({ minimum: MIN_CHECK_TIMEOUT_SECONDS, maximum: MAX_CHECK_TIMEOUT_SECONDS }),
    ),
  ).annotate({ description: `Default ${DEFAULT_CHECK_TIMEOUT_SECONDS}.` }),
  reportOnly: Schema.optional(Schema.Boolean).annotate({
    description: "Exit 0 notifies with stdout instead of waking you.",
  }),
});
export type ScheduledTaskCheck = typeof ScheduledTaskCheck.Type;

/** A task's check as stored, with whether a person approved these exact bytes. */
export const ScheduledTaskCheckState = Schema.Struct({
  taskId: ScheduledTaskId,
  interpreter: CheckInterpreter,
  script: Schema.String,
  timeoutSeconds: Schema.Number,
  reportOnly: Schema.Boolean,
  /** Covers the interpreter and the script, so approving one approves exactly what runs. */
  sha256: Schema.String,
  approved: Schema.Boolean,
});
export type ScheduledTaskCheckState = typeof ScheduledTaskCheckState.Type;

export const ScheduledTaskCheckListResult = Schema.Struct({
  checks: Schema.Array(ScheduledTaskCheckState),
});
export type ScheduledTaskCheckListResult = typeof ScheduledTaskCheckListResult.Type;

/** `check: null` removes it. A check a person saves is approved as saved. */
export const ScheduledTaskCheckSetInput = Schema.Struct({
  taskId: ScheduledTaskId,
  check: Schema.NullOr(ScheduledTaskCheck),
});
export type ScheduledTaskCheckSetInput = typeof ScheduledTaskCheckSetInput.Type;

export const ScheduledTaskCheckSetResult = Schema.Struct({
  check: Schema.NullOr(ScheduledTaskCheckState),
});
export type ScheduledTaskCheckSetResult = typeof ScheduledTaskCheckSetResult.Type;

export const ScheduledTaskCheckApproveInput = Schema.Struct({
  taskId: ScheduledTaskId,
  sha256: Schema.String,
});
export type ScheduledTaskCheckApproveInput = typeof ScheduledTaskCheckApproveInput.Type;

export class CheckScriptError extends Schema.TaggedError<CheckScriptError>()("CheckScriptError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
