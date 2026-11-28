import type { HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentDisciplineSettings,
  DEFAULT_AGENT_DISCIPLINE,
  isLiveSubagentStatus,
  type ProviderDriverKind,
  type ThreadId,
  threadReviewRounds,
  threadSubagentCap,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { budgetRefusal, GUIDED_DRIVERS, guidanceEntries } from "./logic.ts";

export interface ThreadBudget {
  readonly settings: AgentDisciplineSettings;
  readonly cap: number | null;
  /** Live subagents the projection holds, by where they came from. */
  readonly native: number;
  readonly delegated: number;
  readonly reviewRounds: number;
}

export type ClaudeBudgetHooks = Partial<Record<HookEvent, Array<HookCallbackMatcher>>>;

export class AgentDiscipline extends Context.Service<
  AgentDiscipline,
  {
    readonly threadBudget: (threadId: ThreadId) => Effect.Effect<ThreadBudget>;
    /** Why `delegate_task` may not start another task here, or undefined. */
    readonly delegationRefusal: (input: {
      readonly threadId: ThreadId;
      readonly task: string;
    }) => Effect.Effect<string | undefined>;
    /**
     * Hooks that hold one Claude query's native subagents to the budget. The count lives with the
     * query, so a restarted process never inherits subagents that died with the old one.
     */
    readonly claudeHooks: (threadId: ThreadId) => ClaudeBudgetHooks;
    /** The review round cap the PR watch applies; null when off. */
    readonly reviewRoundCap: Effect.Effect<number | null>;
    readonly guidance: (input: {
      readonly threadId: ThreadId;
      readonly driver: ProviderDriverKind | undefined;
    }) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/fork/agentDiscipline/AgentDiscipline") {}

const CLAUDE_SUBAGENT_TOOLS = "^(Agent|Task)$";

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const settingsNow = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.cmdeck.agentDiscipline),
    Effect.orElseSucceed((): AgentDisciplineSettings => DEFAULT_AGENT_DISCIPLINE),
  );

  const threadBudget = Effect.fn("AgentDiscipline.threadBudget")(function* (threadId: ThreadId) {
    const settings = yield* settingsNow;
    const records = yield* projections
      .getThreadRecords(threadId, ["subagents"])
      .pipe(Effect.option, Effect.map(Option.getOrUndefined));
    const live = (records?.subagents ?? []).filter((subagent) =>
      isLiveSubagentStatus(subagent.status),
    );
    return {
      settings,
      cap: threadSubagentCap(settings, records?.thread.tags),
      native: live.filter((subagent) => subagent.origin === "provider_native").length,
      delegated: live.filter((subagent) => subagent.origin === "app_owned").length,
      reviewRounds: threadReviewRounds(records?.thread.pullRequests),
    } satisfies ThreadBudget;
  });

  const delegationRefusal: AgentDiscipline["Service"]["delegationRefusal"] = Effect.fn(
    "AgentDiscipline.delegationRefusal",
  )(function* (input) {
    const budget = yield* threadBudget(input.threadId);
    return budgetRefusal({
      cap: budget.cap,
      running: budget.native + budget.delegated,
      prompt: input.task,
      tool: "delegate_task",
    });
  });

  const claudeHooks: AgentDiscipline["Service"]["claudeHooks"] = (threadId) => {
    let live = 0;
    const preToolUse: HookCallback = (input) =>
      runPromise(
        Effect.gen(function* () {
          if (input.hook_event_name !== "PreToolUse") return {};
          const budget = yield* threadBudget(threadId);
          const toolInput = input.tool_input as { readonly prompt?: unknown } | undefined;
          // Decided after the last await, so parallel Agent calls each see the ones before them.
          const refusal = budgetRefusal({
            cap: budget.cap,
            running: live + budget.delegated,
            prompt: typeof toolInput?.prompt === "string" ? toolInput.prompt : undefined,
            tool: input.tool_name,
          });
          if (refusal !== undefined) {
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: refusal,
              },
            };
          }
          live += 1;
          return {};
        }),
      );
    const subagentStop: HookCallback = () => {
      live = Math.max(0, live - 1);
      return Promise.resolve({});
    };
    return {
      PreToolUse: [{ matcher: CLAUDE_SUBAGENT_TOOLS, hooks: [preToolUse] }],
      SubagentStop: [{ hooks: [subagentStop] }],
    };
  };

  const guidance: AgentDiscipline["Service"]["guidance"] = Effect.fn("AgentDiscipline.guidance")(
    function* (input) {
      if (input.driver === undefined || !GUIDED_DRIVERS.has(input.driver)) return [];
      const budget = yield* threadBudget(input.threadId);
      if (!budget.settings.enabled) return [];
      return guidanceEntries({
        settings: budget.settings,
        cap: budget.cap,
        running: budget.native + budget.delegated,
        reviewRounds: budget.reviewRounds,
      });
    },
  );

  return AgentDiscipline.of({
    threadBudget,
    delegationRefusal,
    claudeHooks,
    reviewRoundCap: settingsNow.pipe(
      Effect.map((settings) => (settings.enabled ? settings.reviewRoundCap : null)),
    ),
    guidance,
  });
});

export const layer = Layer.effect(AgentDiscipline, make);
