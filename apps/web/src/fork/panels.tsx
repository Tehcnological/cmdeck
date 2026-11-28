import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg, useMessages } from "gt-react";
import { BrainIcon } from "lucide-react";
import type { ComponentType } from "react";
import { create } from "zustand";

import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import type { MessageResolver } from "../i18n/messages";
import { useRightPanelStore } from "../rightPanelStore";
import { MemoryUsedPanel } from "./memory/MemoryUsedPanel";
import { PinnedMessagesPanel } from "./pins/PinnedMessagesPanel";
import { WorkLedgerPanel } from "./WorkLedgerPanel";

type ForkPanelTabId = "memory" | "work-ledger" | "pins";

interface ForkPanelTab {
  readonly id: ForkPanelTabId;
  readonly title: string;
  readonly Content: ComponentType<{ readonly threadRef: ScopedThreadRef }>;
}

/**
 * Tabs of the right panel's one fork surface (`cmdeck`). A module adds its tab here; the
 * thread's memory first, then notes, pins and a conductor's work ledger as they land.
 */
const FORK_PANEL_TABS: ReadonlyArray<ForkPanelTab> = [
  { id: "memory", title: msg("Memory used here"), Content: MemoryUsedPanel },
  { id: "work-ledger", title: msg("Work ledger"), Content: WorkLedgerPanel },
  { id: "pins", title: msg("Pinned messages"), Content: PinnedMessagesPanel },
];

const useActiveTab = create<{ readonly id: ForkPanelTabId | null }>(() => ({ id: null }));

/** Opens the thread's fork surface on one tab. */
export function openForkPanel(threadRef: ScopedThreadRef, tab: ForkPanelTabId) {
  useActiveTab.setState({ id: tab });
  useRightPanelStore.getState().open(threadRef, "cmdeck");
}

/** The surface's tab title: its only tab's, or CMDeck once there are several. */
export function forkPanelTitle(resolve: MessageResolver): string {
  const [only] = FORK_PANEL_TABS;
  return FORK_PANEL_TABS.length === 1 && only !== undefined ? resolve(only.title) : "CMDeck";
}

export function ForkPanelIcon() {
  return <BrainIcon className="size-3 shrink-0" />;
}

export function ForkPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const messages = useMessages();
  const activeId = useActiveTab((state) => state.id);
  const active = FORK_PANEL_TABS.find((tab) => tab.id === activeId) ?? FORK_PANEL_TABS[0];
  if (active === undefined) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {FORK_PANEL_TABS.length > 1 ? (
        <div className="border-b px-3 py-2">
          <ToggleGroup
            value={[active.id]}
            onValueChange={(value: ReadonlyArray<string>) => {
              const [next] = value;
              if (next !== undefined) useActiveTab.setState({ id: next as ForkPanelTabId });
            }}
          >
            {FORK_PANEL_TABS.map((tab) => (
              <Toggle key={tab.id} value={tab.id}>
                {messages(tab.title)}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <active.Content threadRef={threadRef} />
      </div>
    </div>
  );
}
