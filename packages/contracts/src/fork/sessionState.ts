import * as Schema from "effect/Schema";

import { ThreadId } from "../baseSchemas.ts";

/** Stored field caps, from Kiro Crew's session ledger (`_MAX_TEXT`, `_MAX_PHASE`); tried kept short. */
export const SESSION_STATE_TEXT_MAX = 2_000;
export const SESSION_STATE_PHASE_MAX = 128;
export const SESSION_STATE_TRIED_MAX = 10;
const SESSION_STATE_TERMINAL_PHASES: ReadonlyArray<string> = ["done", "abandoned"];

/** Phases that end the work (done, abandoned): the card is kept but no longer injected. */
export const isSessionStateFinished = (phase: string): boolean =>
  SESSION_STATE_TERMINAL_PHASES.includes(phase.trim().toLowerCase());

export const SessionStateTried = Schema.Struct({
  approach: Schema.String,
  rejectedBecause: Schema.String,
});
export type SessionStateTried = typeof SessionStateTried.Type;

/** One thread's state card: what a cold resume needs. Fork table, not an orchestration event. */
export const SessionStateCard = Schema.Struct({
  threadId: ThreadId,
  goal: Schema.String,
  phase: Schema.String,
  next: Schema.String,
  /** Rejected approaches, oldest first, at most `SESSION_STATE_TRIED_MAX`. */
  tried: Schema.Array(SessionStateTried),
  updatedAt: Schema.String,
  /** When the card last reached a provider prompt, or null. */
  injectedAt: Schema.NullOr(Schema.String),
});
export type SessionStateCard = typeof SessionStateCard.Type;

export const SessionStateThreadInput = Schema.Struct({ threadId: ThreadId });
export type SessionStateThreadInput = typeof SessionStateThreadInput.Type;

export class SessionStateError extends Schema.TaggedError<SessionStateError>()(
  "SessionStateError",
  {
    reason: Schema.Literals(["empty", "unavailable"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "empty":
        return "Nothing to record: pass at least one field.";
      case "unavailable":
        return "The session state card could not be read or saved.";
    }
  }
}
