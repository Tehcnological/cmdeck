import {
  DEFAULT_AGENT_DISCIPLINE,
  type PullRequestComment,
  threadSubagentCap,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { PullRequestWatchReport } from "../../orchestration-v2/pullRequestWatch.ts";
import {
  applyReviewRoundCap,
  budgetRefusal,
  guidanceEntries,
  withReviewRoundNote,
} from "./logic.ts";

const watch = (reviewRounds?: number): ThreadPullRequestWatch => ({
  startedAt: "2026-11-27T00:00:00.000Z",
  headSha: "abc1234",
  failedChecks: [],
  passed: false,
  passedChecks: [],
  remarksThrough: "2026-11-27T00:00:00.000Z",
  remarkIds: [],
  conflicting: false,
  wakes: 0,
  ...(reviewRounds === undefined ? {} : { reviewRounds }),
});

const remark = (overrides: Partial<PullRequestComment> = {}): PullRequestComment => ({
  id: "r1",
  kind: "review",
  author: { login: "chatgpt-codex-connector", isBot: true, name: null, avatarUrl: null },
  body: "P1: this breaks",
  createdAt: "2026-11-27T00:01:00.000Z",
  url: null,
  path: null,
  reviewState: "COMMENTED",
  ...overrides,
});

const report = (remarks: ReadonlyArray<PullRequestComment>, from = watch()) =>
  ({
    changes: remarks.length === 0 ? [] : [{ kind: "remarks", remarks }],
    next: from,
    exhausted: false,
  }) satisfies PullRequestWatchReport;

describe("budgetRefusal", () => {
  it("allows a subagent under the cap", () => {
    expect(budgetRefusal({ cap: 2, running: 1, prompt: "do it", tool: "Agent" })).toBeUndefined();
  });

  it("refuses one at the cap and says how to justify it", () => {
    const refusal = budgetRefusal({ cap: 2, running: 2, prompt: "do it", tool: "Agent" });
    expect(refusal).toContain("2 of 2 already running");
    expect(refusal).toContain("Budget justification:");
  });

  it("allows one past the cap when the prompt justifies it", () => {
    expect(
      budgetRefusal({
        cap: 2,
        running: 5,
        prompt:
          "Budget justification: both audits found the same race in two unrelated stores.\n\nFix it.",
        tool: "Agent",
      }),
    ).toBeUndefined();
  });

  it("does not take an empty justification", () => {
    expect(
      budgetRefusal({ cap: 0, running: 0, prompt: "Budget justification: yes", tool: "Agent" }),
    ).toBeDefined();
  });

  it("never refuses without a cap", () => {
    expect(budgetRefusal({ cap: null, running: 40, prompt: "", tool: "Agent" })).toBeUndefined();
  });
});

describe("threadSubagentCap", () => {
  it("uses the global cap, a thread tag override, or none when off", () => {
    expect(threadSubagentCap(DEFAULT_AGENT_DISCIPLINE, [])).toBe(2);
    expect(threadSubagentCap(DEFAULT_AGENT_DISCIPLINE, ["subagent-cap:5"])).toBe(5);
    expect(threadSubagentCap(DEFAULT_AGENT_DISCIPLINE, ["subagent-cap:off"])).toBeNull();
    expect(threadSubagentCap({ ...DEFAULT_AGENT_DISCIPLINE, enabled: false }, [])).toBeNull();
    expect(threadSubagentCap(DEFAULT_AGENT_DISCIPLINE, ["subagent-cap:lots"])).toBe(2);
  });
});

describe("guidanceEntries", () => {
  it("states the done-check loop, the live budget and the round count", () => {
    const text = guidanceEntries({
      settings: DEFAULT_AGENT_DISCIPLINE,
      cap: 2,
      running: 1,
      reviewRounds: 1,
    }).join("\n");
    expect(text).toContain("Done-check");
    expect(text).toContain("at most 2 running at once (1 now)");
    expect(text).toContain("Stop after 2 review rounds (1 so far)");
    expect(text).toContain("every 20 minutes");
    expect(text).toContain("3 changes in a row");
  });

  it("keeps every entry within the turn context entry limit", () => {
    for (const entry of guidanceEntries({
      settings: DEFAULT_AGENT_DISCIPLINE,
      cap: 32,
      running: 32,
      reviewRounds: 20,
    })) {
      expect(entry.length).toBeLessThanOrEqual(600);
    }
  });
});

describe("applyReviewRoundCap", () => {
  it("counts a bot's review as a round and leaves other remarks alone", () => {
    const human = remark({
      author: { login: "chris", name: null, avatarUrl: null },
    });
    expect(applyReviewRoundCap(report([human]), watch(), 2).report.next.reviewRounds).toBe(0);
    const inline = remark({ kind: "review-comment" });
    expect(applyReviewRoundCap(report([inline]), watch(), 2).report.next.reviewRounds).toBe(0);
    const first = applyReviewRoundCap(report([remark()]), watch(), 2);
    expect(first.report.next.reviewRounds).toBe(1);
    expect(first.report.exhausted).toBe(false);
    expect(first.note).toContain("round 1 of 2");
  });

  it("counts a bot by its [bot] login when the host does not flag it", () => {
    const bot = remark({
      author: { login: "coderabbitai[bot]", name: null, avatarUrl: null },
    });
    expect(applyReviewRoundCap(report([bot]), watch(), 2).report.next.reviewRounds).toBe(1);
  });

  it("marks the last allowed round, then ends the watch past the cap", () => {
    const last = applyReviewRoundCap(report([remark()]), watch(1), 2);
    expect(last.note).toContain("the last one");
    expect(last.report.exhausted).toBe(false);

    const past = applyReviewRoundCap(report([remark()]), watch(2), 2);
    expect(past.report.exhausted).toBe(true);
    expect(past.capEnded).toBe(true);
    expect(past.note).toContain("Do not fix these findings");
  });

  it("keeps counting without a cap", () => {
    const outcome = applyReviewRoundCap(report([remark()]), watch(7), 0);
    expect(outcome.report.next.reviewRounds).toBe(8);
    expect(outcome.report.exhausted).toBe(false);
    expect(outcome.note).toBeUndefined();
  });

  it("puts the cap note where the closing line about watching again was", () => {
    const past = applyReviewRoundCap(report([remark()]), watch(2), 2);
    const text = withReviewRoundNote("Update on #1:\n- 1 new comment\n\nCall watch again.", past);
    expect(text).not.toContain("Call watch again.");
    expect(text.endsWith(past.note!)).toBe(true);
  });
});
