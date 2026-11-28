import {
  type AgentDisciplineSettings,
  BUDGET_JUSTIFICATION_PREFIX,
  hasBudgetJustification,
  isReviewBotRemark,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";

import type { PullRequestWatchReport } from "../../orchestration-v2/pullRequestWatch.ts";

/** Drivers that get the guidance. ACP drivers (Antigravity and the registry agents) are left alone. */
export const GUIDED_DRIVERS: ReadonlySet<string> = new Set([
  "claudeAgent",
  "codex",
  "cursor",
  "opencode",
  "grok",
]);

/** Why a new subagent may not start, or undefined when it may. */
export function budgetRefusal(input: {
  readonly cap: number | null;
  readonly running: number;
  readonly prompt: string | undefined;
  readonly tool: string;
}): string | undefined {
  if (input.cap === null || input.running < input.cap) return undefined;
  if (hasBudgetJustification(input.prompt)) return undefined;
  return [
    `CMDeck subagent budget: ${input.running} of ${input.cap} already running, so this ${input.tool} was refused.`,
    "Do this work yourself in this thread.",
    `Only if what earlier subagents returned shows you need another, start its prompt with "${BUDGET_JUSTIFICATION_PREFIX}" followed by what they found and why it needs one more, then call it again.`,
  ].join(" ");
}

/** The working rules for a coding turn, short enough for the turn context block. */
export function guidanceEntries(input: {
  readonly settings: AgentDisciplineSettings;
  readonly cap: number | null;
  readonly running: number;
  readonly reviewRounds: number;
}): ReadonlyArray<string> {
  const { settings } = input;
  const reviewCap = settings.reviewRoundCap;
  return [
    "Done-check: before the first edit, name one measurable check that proves the task (a test command, benchmark, typecheck or repro). Run it before you change anything and after every change.",
    "Keep a short per-change log in your replies: change, check before -> after, kept or reverted. Revert a change that does not improve or hold the check. Prefer small sequential edits to broad parallel ones.",
    input.cap === null
      ? "Subagents: do the work yourself unless a task is truly independent."
      : `Subagent budget: at most ${input.cap} running at once (${input.running} now). Do the work yourself by default. Past the budget, a subagent's prompt must start with "${BUDGET_JUSTIFICATION_PREFIX}" and say what earlier subagents found that needs one more; CMDeck refuses it otherwise.`,
    "Before you say done, review your own diff against the done-check. Before you open a PR or mark one ready (which starts any review bot the project has, such as Codex), tests, lint, typecheck and the done-check must pass; put their results in the PR body.",
    reviewCap === 0
      ? "If a review bot reviews the PR: fix its real findings and re-run every check before pushing."
      : `If a review bot reviews the PR: fix its real findings and re-run every check before pushing. Stop after ${reviewCap} review rounds (${input.reviewRounds} so far) and list what is left for the user instead of fixing it.`,
    [
      settings.checkpointMinutes > 0
        ? `On a long run, report progress to the user about every ${settings.checkpointMinutes} minutes.`
        : undefined,
      settings.stallLimit > 0
        ? `If the done-check has not improved in ${settings.stallLimit} changes in a row, stop and report what you tried.`
        : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(" "),
  ].filter((entry) => entry.length > 0);
}

export interface ReviewRoundOutcome {
  readonly report: PullRequestWatchReport;
  /** What the agent is told about the round, at the end of its wake. */
  readonly note: string | undefined;
  /** The cap ended the watch; the note replaces the closing line about watching again. */
  readonly capEnded: boolean;
}

/** Counts review bot rounds on a watch and, past the cap, ends it with a hand-off to the user. */
export function applyReviewRoundCap(
  report: PullRequestWatchReport,
  watch: ThreadPullRequestWatch,
  cap: number | null,
): ReviewRoundOutcome {
  const before = watch.reviewRounds ?? 0;
  const reviewed = report.changes.some(
    (change) => change.kind === "remarks" && change.remarks.some(isReviewBotRemark),
  );
  const rounds = before + (reviewed ? 1 : 0);
  const counted = { ...report, next: { ...report.next, reviewRounds: rounds } };
  if (!reviewed || cap === null || cap === 0) {
    return { report: counted, note: undefined, capEnded: false };
  }
  if (rounds < cap) {
    return {
      report: counted,
      note: `CMDeck: review bot round ${rounds} of ${cap}. Fix the real findings, re-run tests, lint, typecheck and the done-check, then push.`,
      capEnded: false,
    };
  }
  if (rounds === cap) {
    return {
      report: counted,
      note: `CMDeck: review bot round ${rounds} of ${cap}, the last one. Fix the real findings, re-run every check, push, and do not ask for another review. Anything a later review finds goes to the user.`,
      capEnded: false,
    };
  }
  return {
    report: { ...counted, exhausted: true },
    note: `CMDeck: the review round cap (${cap}) is reached and this watch has ended. Do not fix these findings. List each remaining one for the user (file, what is wrong, how severe) and end your turn.`,
    capEnded: true,
  };
}

export function withReviewRoundNote(text: string, outcome: ReviewRoundOutcome): string {
  if (outcome.note === undefined) return text;
  if (!outcome.capEnded) return `${text}\n\n${outcome.note}`;
  const closing = text.lastIndexOf("\n");
  return `${closing === -1 ? text : text.slice(0, closing)}\n${outcome.note}`;
}
