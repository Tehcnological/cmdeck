import { useAtomValue } from "@effect/atom-react";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { canOpenThreadInPanel } from "../lib/sideChatPane";
import { useRightPanelStore } from "../rightPanelStore";
import { environmentThreadShells } from "../state/threads";

/**
 * Closes a tab whose thread a tag filter hides, as the main view leaves a hidden thread. An
 * ordinary thread opened beside another can be hidden on its own, unlike a side chat or subagent.
 */
export function useCloseWhenHidden(threadRef: ScopedThreadRef, onClose: () => void) {
  const hidden = useAtomValue(environmentThreadShells.hiddenThreadKeysAtom).has(
    threadKey(threadRef),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the tag filter lives in a shared atom; closing the tab is a store action, not render state
  useEffect(() => {
    if (hidden) onClose();
  }, [hidden, onClose]);
}

/** Whether `threadRef` can open as a tab beside `panelRef`, the thread on screen. */
export function canOpenThreadBeside(
  threadRef: ScopedThreadRef,
  panelRef: ScopedThreadRef | null,
): boolean {
  return canOpenThreadInPanel(threadRef, panelRef);
}

/**
 * Opens any thread, not only a side chat or subagent, as a tab in the right panel of the thread on
 * screen. Narrow screens show that panel as a sheet. Returns whether it opened.
 */
export function openThreadBeside(
  threadRef: ScopedThreadRef,
  panelRef: ScopedThreadRef | null,
): boolean {
  if (!canOpenThreadInPanel(threadRef, panelRef)) return false;
  useRightPanelStore.getState().openThread(panelRef, threadRef.threadId);
  return true;
}
