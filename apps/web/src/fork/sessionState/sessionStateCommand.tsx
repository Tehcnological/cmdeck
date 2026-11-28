import { useGT } from "gt-react";
import { NotebookPenIcon } from "lucide-react";

import type { CommandPaletteActionItem } from "../../components/CommandPalette.logic";
import { ITEM_ICON_CLASS } from "../../components/CommandPalette.logic";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { openForkPanel } from "../panels";

export const commandOrder = 45;

/** "Show session state card": opens the State card tab of the thread on screen. */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const threadRef = useThreadRouteRef();
  if (threadRef === null) return [];
  return [
    {
      kind: "action",
      value: "action:fork:show-session-state",
      searchTerms: ["state card", "session state", "goal", "next step", "resume"],
      title: gt("Show session state card"),
      icon: <NotebookPenIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        openForkPanel(threadRef, "sessionState");
      },
    },
  ];
}
