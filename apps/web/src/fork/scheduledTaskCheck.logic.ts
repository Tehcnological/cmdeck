import {
  type CheckInterpreter,
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  MAX_CHECK_SCRIPT_CHARS,
  MAX_CHECK_TIMEOUT_SECONDS,
  MIN_CHECK_TIMEOUT_SECONDS,
  type ScheduledTaskCheck,
  type ScheduledTaskCheckState,
} from "@t3tools/contracts";

export interface CheckDraft {
  readonly interpreter: CheckInterpreter;
  readonly script: string;
  readonly timeoutSeconds: string;
  readonly reportOnly: boolean;
}

export const CHECK_INTERPRETERS: ReadonlyArray<CheckInterpreter> = ["bash", "node", "pwsh"];

/** "none" offers to add one; "pending" means an agent's script waits for a person. */
export function checkStatus(state: ScheduledTaskCheckState | undefined) {
  if (state === undefined) return "none" as const;
  return state.approved ? ("approved" as const) : ("pending" as const);
}

export function checkDraftFrom(state: ScheduledTaskCheckState | undefined): CheckDraft {
  return state === undefined
    ? {
        interpreter: "bash",
        script: "",
        timeoutSeconds: String(DEFAULT_CHECK_TIMEOUT_SECONDS),
        reportOnly: false,
      }
    : {
        interpreter: state.interpreter,
        script: state.script,
        timeoutSeconds: String(state.timeoutSeconds),
        reportOnly: state.reportOnly,
      };
}

export type CheckDraftProblem = "empty" | "tooLong" | "timeout";

/** The check a draft saves, or what is wrong with it. */
export function checkFromDraft(
  draft: CheckDraft,
): { readonly check: ScheduledTaskCheck } | { readonly problem: CheckDraftProblem } {
  if (draft.script.trim() === "") return { problem: "empty" };
  if (draft.script.length > MAX_CHECK_SCRIPT_CHARS) return { problem: "tooLong" };
  const timeout = Number(draft.timeoutSeconds.trim());
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_CHECK_TIMEOUT_SECONDS ||
    timeout > MAX_CHECK_TIMEOUT_SECONDS
  ) {
    return { problem: "timeout" };
  }
  return {
    check: {
      interpreter: draft.interpreter,
      script: draft.script,
      timeoutSeconds: timeout,
      reportOnly: draft.reportOnly,
    },
  };
}

/** Whether the draft still shows the stored check, so the dialog approves those bytes rather than saving. */
export function draftMatches(draft: CheckDraft, state: ScheduledTaskCheckState | undefined) {
  if (state === undefined) return false;
  const saved = checkDraftFrom(state);
  return (
    draft.interpreter === saved.interpreter &&
    draft.script === saved.script &&
    draft.timeoutSeconds.trim() === saved.timeoutSeconds &&
    draft.reportOnly === saved.reportOnly
  );
}
