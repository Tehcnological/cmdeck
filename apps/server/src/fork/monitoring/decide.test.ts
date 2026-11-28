import { describe, expect, it } from "@effect/vitest";

import {
  decide,
  type LoopDecision,
  type LoopState,
  type LoopTick,
  replyHasSentinel,
} from "./decide.ts";

const state: LoopState = {
  mode: "interval",
  everyMs: 60_000,
  maxCycles: 3,
  cycles: 0,
  expiresAt: 10_000_000,
  lastOutputHash: null,
  stoppedReason: null,
};
const tick: LoopTick = {
  now: 1_000_000,
  manual: false,
  thread: "live",
  busy: false,
  lastSettledAt: null,
  check: "none",
  outputHash: null,
};

describe("decide", () => {
  it.each<[string, Partial<LoopState>, Partial<LoopTick>, LoopDecision]>([
    ["a quiet live thread wakes", {}, {}, { _tag: "Wake", last: false }],
    ["the wake that spends the budget says so", { cycles: 2 }, {}, { _tag: "Wake", last: true }],
    ["a spent budget stops", { cycles: 3 }, {}, { _tag: "Stop", reason: "budget" }],
    ["expiry stops", {}, { now: 10_000_000 }, { _tag: "Stop", reason: "expired" }],
    [
      "expiry stops before the budget",
      { cycles: 3 },
      { now: 10_000_000 },
      { _tag: "Stop", reason: "expired" },
    ],
    [
      "an ended loop stays ended",
      { stoppedReason: "sentinel" },
      {},
      { _tag: "Stop", reason: "stopped" },
    ],
    [
      "an archived thread stops",
      {},
      { thread: "archived" },
      { _tag: "Stop", reason: "thread_archived" },
    ],
    ["a deleted thread stops", {}, { thread: "gone" }, { _tag: "Stop", reason: "thread_gone" }],
    [
      "terminal states win over a manual run",
      { cycles: 3 },
      { manual: true },
      { _tag: "Stop", reason: "budget" },
    ],
    ["a busy thread coalesces the wake", {}, { busy: true }, { _tag: "Skip", reason: "busy" }],
    [
      "a manual run wakes a busy thread",
      {},
      { busy: true, manual: true },
      { _tag: "Wake", last: false },
    ],
    ["the check's skip stands", {}, { check: "done" }, { _tag: "PassThrough" }],
    ["the check's failure stands", {}, { check: "failed" }, { _tag: "PassThrough" }],
    [
      "an unchanged check output skips",
      { lastOutputHash: "abc" },
      { check: "wake", outputHash: "abc" },
      { _tag: "Skip", reason: "unchanged" },
    ],
    [
      "a changed check output wakes",
      { lastOutputHash: "abc" },
      { check: "wake", outputHash: "def" },
      { _tag: "Wake", last: false },
    ],
    [
      "without a check, the same prompt is not a duplicate",
      { lastOutputHash: "abc" },
      { check: "none", outputHash: null },
      { _tag: "Wake", last: false },
    ],
    [
      "idle mode waits until the thread has been quiet long enough",
      { mode: "idle" },
      { lastSettledAt: 1_000_000 - 30_000 },
      { _tag: "Skip", reason: "idle" },
    ],
    [
      "idle mode wakes once the wait has passed",
      { mode: "idle" },
      { lastSettledAt: 1_000_000 - 60_000 },
      { _tag: "Wake", last: false },
    ],
    [
      "interval mode ignores when the last turn ended",
      {},
      { lastSettledAt: 1_000_000 - 1_000 },
      { _tag: "Wake", last: false },
    ],
  ])("%s", (_name, loop, at, expected) => {
    expect(decide({ ...state, ...loop }, { ...tick, ...at })).toEqual(expected);
  });
});

describe("replyHasSentinel", () => {
  it.each([
    ["All green.\nMONITOR_DONE", true],
    ["Done.\n\n**MONITOR_DONE**", true],
    ["`MONITOR_DONE`", true],
    ["I will reply MONITOR_DONE when CI passes.", false],
    ["MONITOR_DONE_LATER", false],
  ])("%j → %s", (reply, expected) => {
    expect(replyHasSentinel(reply, "MONITOR_DONE")).toBe(expected);
  });
});
