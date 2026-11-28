import { useGT } from "gt-react";
import { PinIcon } from "lucide-react";

import type { CommandPaletteActionItem } from "../../components/CommandPalette.logic";
import { ITEM_ICON_CLASS } from "../../components/CommandPalette.logic";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { openForkPanel } from "../panels";

export const commandOrder = 40;

/** "Show pinned messages": opens the Pinned tab of the thread on screen. */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const threadRef = useThreadRouteRef();
  if (threadRef === null) return [];
  return [
    {
      kind: "action",
      value: "action:fork:show-pins",
      searchTerms: ["pin", "pinned", "pins", "bookmark", "saved messages"],
      title: gt("Show pinned messages"),
      icon: <PinIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        openForkPanel(threadRef, "pins");
      },
    },
  ];
}
