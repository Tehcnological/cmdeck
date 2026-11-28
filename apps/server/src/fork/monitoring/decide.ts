// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/monitoring/decision.py
// (Apache-2.0): terminal states, then budget, then dedup by fingerprint. Changes: one loop shape,
// a busy thread coalesces into the next tick, and idle mode waits on the last settled turn.
import * as DateTime from "effect/DateTime";

export type LoopMode = "interval" | "idle";

export type StopReason = "stopped" | "thread_archived" | "thread_gone" | "expired" | "budget";

export interface LoopState {
  readonly mode: LoopMode;
  /** The interval, or in idle mode how long the thread stays quiet before a wake. */
  readonly everyMs: number;
  readonly maxCycles: number;
  readonly cycles: number;
  readonly expiresAt: number;
  readonly lastOutputHash: string | null;
  /** Set once the loop ended between ticks (its sentinel, `monitor_stop`). */
  readonly stoppedReason: string | null;
}

export interface LoopTick {
  readonly now: number;
  /** A person pressed Run now: it wakes unless the loop is over. */
  readonly manual: boolean;
  readonly thread: "live" | "archived" | "gone";
  /** A run is active or queued on the thread. */
  readonly busy: boolean;
  readonly lastSettledAt: number | null;
  /** What the task's check script said; `none` when it has none. */
  readonly check: "none" | "wake" | "done" | "failed";
  /** A hash of the check's wake text; compared only when `check` is `wake`. */
  readonly outputHash: string | null;
}

export type LoopDecision =
  | { readonly _tag: "Stop"; readonly reason: StopReason }
  /** The check script ended the run itself (skip or failure); its result stands. */
  | { readonly _tag: "PassThrough" }
  | { readonly _tag: "Skip"; readonly reason: "busy" | "idle" | "unchanged" }
  | { readonly _tag: "Wake"; readonly last: boolean };

export function decide(state: LoopState, tick: LoopTick): LoopDecision {
  if (state.stoppedReason !== null) return { _tag: "Stop", reason: "stopped" };
  if (tick.thread === "gone") return { _tag: "Stop", reason: "thread_gone" };
  if (tick.thread === "archived") return { _tag: "Stop", reason: "thread_archived" };
  if (tick.now >= state.expiresAt) return { _tag: "Stop", reason: "expired" };
  if (state.cycles >= state.maxCycles) return { _tag: "Stop", reason: "budget" };
  if (tick.check === "done" || tick.check === "failed") return { _tag: "PassThrough" };
  if (!tick.manual) {
    // A wake behind a running turn would queue; the next tick sees whatever this one would have.
    if (tick.busy) return { _tag: "Skip", reason: "busy" };
    if (
      state.mode === "idle" &&
      tick.lastSettledAt !== null &&
      tick.now - tick.lastSettledAt < state.everyMs
    ) {
      return { _tag: "Skip", reason: "idle" };
    }
    if (tick.check === "wake" && tick.outputHash === state.lastOutputHash) {
      return { _tag: "Skip", reason: "unchanged" };
    }
  }
  return { _tag: "Wake", last: state.cycles + 1 >= state.maxCycles };
}

/** Letters, digits and `_-:.`, so a reply line can be compared without markdown around it. */
export const SENTINEL_PATTERN = /^[A-Za-z0-9_:.-]{3,64}$/;

/** Whether some line of the reply is the sentinel alone, ignoring markdown emphasis and code ticks. */
export function replyHasSentinel(reply: string, sentinel: string): boolean {
  return reply.split("\n").some((line) => line.replace(/^[\s`*_~>]+|[\s`*_~]+$/g, "") === sentinel);
}

/** The line a wake carries after the task's prompt, so the agent knows where the loop stands. */
export function wakeNote(input: {
  readonly cycle: number;
  readonly maxCycles: number;
  readonly expiresAt: number;
  readonly sentinel: string | null;
  readonly last: boolean;
}): string {
  const parts = [
    `[Monitor loop: wake ${input.cycle} of ${input.maxCycles}, ends ${DateTime.formatIso(DateTime.makeUnsafe(input.expiresAt))}.`,
    input.last ? "This is the last wake." : null,
    "If nothing needs the user, call nothing_to_report.",
    input.sentinel === null
      ? null
      : `To end the loop, reply with a line holding only ${input.sentinel}.`,
  ];
  return `${parts.filter((part) => part !== null).join(" ")}]`;
}
