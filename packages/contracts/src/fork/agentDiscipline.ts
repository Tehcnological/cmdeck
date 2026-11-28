import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { PullRequestComment } from "../pullRequest.ts";
import type { ThreadPullRequestLink } from "../threadPullRequest.ts";

const Count = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }));

export const DEFAULT_AGENT_DISCIPLINE = {
  enabled: true,
  subagentCap: 2,
  reviewRoundCap: 2,
  checkpointMinutes: 20,
  stallLimit: 3,
} as const;

/**
 * How agents work by default: a concurrent subagent budget, a measured done-check loop, a check
 * gate before the PR review bot, a review round cap and progress checkpoints. On unless turned off.
 */
export const AgentDisciplineSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_DISCIPLINE.enabled)),
  ),
  /** Subagents running at once; past it an agent must justify another. 0 allows none unjustified. */
  subagentCap: Count(32).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_DISCIPLINE.subagentCap)),
  ),
  /**
   * PR review bot rounds (Codex or any other bot account that submits reviews) an agent fixes
   * before it hands the rest to the user. 0 is no cap. Projects without a review bot never count.
   */
  reviewRoundCap: Count(20).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_DISCIPLINE.reviewRoundCap)),
  ),
  /** Minutes between progress notes on a long run. 0 turns them off. */
  checkpointMinutes: Count(240).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_DISCIPLINE.checkpointMinutes)),
  ),
  /** Changes in a row without the done-check improving before the agent stops. 0 is no limit. */
  stallLimit: Count(50).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_DISCIPLINE.stallLimit)),
  ),
});
export type AgentDisciplineSettings = typeof AgentDisciplineSettings.Type;

export const AgentDisciplineSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  subagentCap: Schema.optionalKey(Count(32)),
  reviewRoundCap: Schema.optionalKey(Count(20)),
  checkpointMinutes: Schema.optionalKey(Count(240)),
  stallLimit: Schema.optionalKey(Count(50)),
});

/** A thread tag `subagent-cap:<n>` or `subagent-cap:off` overrides the global cap for that thread. */
export const SUBAGENT_CAP_TAG_PREFIX = "subagent-cap:";

export const subagentCapTag = (cap: number | "off") => `${SUBAGENT_CAP_TAG_PREFIX}${cap}`;

/** The thread's own cap tags, so a change can remove them before adding the new one. */
export const subagentCapTags = (tags: ReadonlyArray<string> | undefined) =>
  (tags ?? []).filter((tag) => tag.startsWith(SUBAGENT_CAP_TAG_PREFIX));

/** The concurrent subagent cap for a thread; null means no cap. */
export function threadSubagentCap(
  settings: AgentDisciplineSettings,
  tags: ReadonlyArray<string> | undefined,
): number | null {
  if (!settings.enabled) return null;
  const override = subagentCapTags(tags).at(-1)?.slice(SUBAGENT_CAP_TAG_PREFIX.length);
  if (override === "off") return null;
  if (override !== undefined && /^\d{1,2}$/u.test(override)) return Number(override);
  return settings.subagentCap;
}

/** A subagent prompt that starts with this may run past the cap. */
export const BUDGET_JUSTIFICATION_PREFIX = "Budget justification:";

export const hasBudgetJustification = (prompt: string | undefined) => {
  const text = prompt?.trimStart() ?? "";
  return (
    text.slice(0, BUDGET_JUSTIFICATION_PREFIX.length).toLowerCase() ===
      BUDGET_JUSTIFICATION_PREFIX.toLowerCase() &&
    text.slice(BUDGET_JUSTIFICATION_PREFIX.length).trim().length >= 20
  );
};

const LIVE_SUBAGENT_STATUSES = new Set(["idle", "pending", "running", "waiting"]);

export const isLiveSubagentStatus = (status: string) => LIVE_SUBAGENT_STATUSES.has(status);

/** A review a bot account submitted, such as Codex's; its inline comments ride on the review. */
export const isReviewBotRemark = (remark: Pick<PullRequestComment, "kind" | "author">) =>
  remark.kind === "review" &&
  remark.author !== null &&
  (remark.author.isBot === true || /\[bot\]$/iu.test(remark.author.login));

/** The most review rounds any of the thread's pull requests has had. */
export const threadReviewRounds = (
  pullRequests: ReadonlyArray<Pick<ThreadPullRequestLink, "watch" | "endedWatch">> | undefined,
) =>
  Math.max(
    0,
    ...(pullRequests ?? []).map(
      (link) => link.watch?.reviewRounds ?? link.endedWatch?.reviewRounds ?? 0,
    ),
  );
