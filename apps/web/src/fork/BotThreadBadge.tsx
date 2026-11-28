import { useAtomValue } from "@effect/atom-react";
import type { BotProfile, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";
import { BotIcon } from "lucide-react";

import { botList } from "./bots";

const NO_BOTS: ReadonlyArray<BotProfile> = [];

/** A small bot mark before a live bot's thread title in the sidebar. */
export function BotThreadBadge(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const bots = AsyncResult.getOrElse(
    useAtomValue(botList({ environmentId: props.environmentId, input: {} })),
    () => NO_BOTS,
  );
  const bot = bots.find((entry) => entry.threadId === props.threadId && entry.status === "active");
  if (bot === undefined) return null;
  return (
    <BotIcon
      role="img"
      aria-label={gt("Bot", { $context: "label for an icon marking a bot's thread" })}
      className="me-1 inline size-3.5 shrink-0 align-[-2px] text-muted-foreground"
    />
  );
}
