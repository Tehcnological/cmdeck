import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { BotIcon } from "lucide-react";
import { createElement } from "react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { NEW_BOT_TARGET } from "./BotsSection";

export const commandOrder = 10;

/** "New bot": opens the bot form in Settings > Threads. */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const navigate = useNavigate();
  return [
    {
      kind: "action",
      value: "action:cmdeck:new-bot",
      searchTerms: ["bot", "agent", "persistent", "crew", "schedule"],
      title: gt("New bot"),
      description: gt("A persistent agent with its own pinned thread and private memory"),
      icon: createElement(BotIcon, { className: ITEM_ICON_CLASS }),
      run: async () => {
        await navigate({ to: "/settings/threads", hash: NEW_BOT_TARGET });
      },
    },
  ];
}
