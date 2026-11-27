import type { ScopedThreadRef } from "@t3tools/contracts";

import { canOpenThreadInPanel } from "../lib/sideChatPane";
import { useRightPanelStore } from "../rightPanelStore";

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
