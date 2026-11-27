import { useAtomValue } from "@effect/atom-react";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { canOpenThreadInPanel } from "../lib/sideChatPane";
import { useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
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

type CheckoutOf = Pick<EnvironmentThreadShell, "projectId" | "worktreePath">;

/**
 * The panel's terminal, file previews and Run buttons all work in its host thread's checkout, as
 * a side chat or subagent shares it. Another thread may open there only when it shares it too.
 */
export function sharesCheckout(thread: CheckoutOf | null, host: CheckoutOf | null): boolean {
  return (
    thread !== null &&
    host !== null &&
    thread.projectId === host.projectId &&
    (thread.worktreePath ?? null) === (host.worktreePath ?? null)
  );
}

const quietShell = (ref: ScopedThreadRef) =>
  appAtomRegistry.get(environmentThreadShells.quietThreadShellAtom(ref));

/** Whether `threadRef` can open as a tab beside `panelRef`, the thread on screen. */
export function canOpenThreadBeside(
  threadRef: ScopedThreadRef,
  panelRef: ScopedThreadRef | null,
): boolean {
  return (
    canOpenThreadInPanel(threadRef, panelRef) &&
    sharesCheckout(quietShell(threadRef), quietShell(panelRef))
  );
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
