import {
  AuthOrchestrationOperateScope,
  isLiveSubagentStatus,
  type ScopedThreadRef,
  SUBAGENT_CAP_TAG_PREFIX,
  subagentCapTag,
  subagentCapTags,
  threadReviewRounds,
  threadSubagentCap,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { BotIcon, MessageSquareCodeIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../components/ui/menu";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useQuietThreadProjection } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

const CAP_CHOICES = ["0", "1", "2", "3", "4", "6", "8"] as const;

/**
 * Header counts for CMDeck's agent budget: subagents running against the cap and PR review bot
 * rounds against theirs. The menu sets this thread's own subagent cap through a thread tag.
 */
export function AgentBudgetIndicator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const discipline = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.cmdeck.agentDiscipline,
  );
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const setTag = useOrchestrationCommand(threadEnvironment.setTag, { label: "set subagent cap" });
  if (projection === undefined || !discipline.enabled) return null;

  const tags = projection.thread.tags ?? [];
  const cap = threadSubagentCap(discipline, tags);
  const running = projection.subagents.filter((subagent) =>
    isLiveSubagentStatus(subagent.status),
  ).length;
  const rounds = threadReviewRounds(projection.thread.pullRequests);
  const reviewCap = discipline.reviewRoundCap;
  const override = subagentCapTags(tags).at(-1)?.slice(SUBAGENT_CAP_TAG_PREFIX.length);

  const chooseCap = async (value: string) => {
    const next =
      value === "default" ? null : subagentCapTag(value === "off" ? "off" : Number(value));
    const input = { threadId: threadRef.threadId };
    for (const tag of subagentCapTags(tags)) {
      if (tag === next) continue;
      await setTag({
        environmentId: threadRef.environmentId,
        input: { ...input, tag, tagged: false },
      });
    }
    if (next !== null && !tags.includes(next)) {
      await setTag({
        environmentId: threadRef.environmentId,
        input: { ...input, tag: next, tagged: true },
      });
    }
  };

  const capLabel = cap === null ? "∞" : String(cap);
  const overCap = cap !== null && running > cap;
  const summary = gt(
    "Subagents running: {running} of {cap}. Review bot rounds: {rounds} of {reviewCap}.",
    {
      running,
      cap: cap === null ? gt("no cap") : cap,
      rounds,
      reviewCap: reviewCap === 0 ? gt("no cap") : reviewCap,
    },
  );

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            className="shrink-0"
            disabled={!canOperate}
            aria-label={summary}
            title={summary}
          />
        }
      >
        <span className="flex items-center gap-2 tabular-nums">
          <span
            className={overCap ? "flex items-center gap-1 text-warning" : "flex items-center gap-1"}
          >
            <BotIcon aria-hidden className="size-3.5" />
            {running}/{capLabel}
          </span>
          {rounds > 0 ? (
            <span
              className={
                reviewCap !== 0 && rounds > reviewCap
                  ? "flex items-center gap-1 text-warning"
                  : "flex items-center gap-1"
              }
            >
              <MessageSquareCodeIcon aria-hidden className="size-3.5" />
              {rounds}/{reviewCap === 0 ? "∞" : reviewCap}
            </span>
          ) : null}
        </span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>
            <T>Subagents at once in this thread</T>
          </MenuGroupLabel>
          <MenuRadioGroup value={override ?? "default"} onValueChange={(value) => chooseCap(value)}>
            <MenuRadioItem value="default" closeOnClick>
              {gt("Default ({cap})", { cap: discipline.subagentCap })}
            </MenuRadioItem>
            {CAP_CHOICES.map((choice) => (
              <MenuRadioItem key={choice} value={choice} closeOnClick>
                {choice}
              </MenuRadioItem>
            ))}
            <MenuRadioItem value="off" closeOnClick>
              <T>No cap</T>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
