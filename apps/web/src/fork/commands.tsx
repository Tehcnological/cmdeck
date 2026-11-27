import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { BotIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { NEW_BOT_TARGET } from "./BotsSection";

/** Fork rows in the command palette's root list. A module adds its rows here, only while it is on. */
export function useForkCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const navigate = useNavigate();
  return [
    {
      kind: "action",
      value: "cmdeck:new-bot",
      searchTerms: ["bot", "agent", "persistent", "crew", "schedule"],
      title: gt("New bot"),
      description: gt("A persistent agent with its own pinned thread and private memory"),
      icon: <BotIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings/threads", hash: NEW_BOT_TARGET });
      },
    },
  ];
}
