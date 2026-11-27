import type { LegendListRef } from "@legendapp/list/react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";
import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";

import { toastManager } from "../../components/ui/toast";
import { m } from "../../i18n/messages";
import { type JumpHistory, nextJumpStep } from "./pins.logic";

interface JumpRequest {
  readonly threadKey: string;
  readonly messageId: MessageId;
}

let pending: JumpRequest | null = null;
const listeners = new Set<() => void>();
const publish = (next: JumpRequest | null) => {
  pending = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Asks the timeline showing `threadRef` to bring `messageId` into view. */
export function requestMessageJump(threadRef: ScopedThreadRef, messageId: MessageId) {
  publish({ threadKey: scopedThreadKey(threadRef), messageId });
}

const JUMP_VIEW_OFFSET = 24;

/** The timeline's side of a jump: scrolls to the message, loading older history when needed. */
export function useMessagePinJump(input: {
  readonly threadKey: string;
  readonly rows: Parameters<typeof nextJumpStep>[0]["rows"];
  readonly entries: Parameters<typeof nextJumpStep>[0]["entries"];
  readonly history:
    | (JumpHistory & { onLoadEarlier: (throughEntryId?: string) => void })
    | undefined;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly navigate: () => void;
}) {
  const request = useSyncExternalStore(subscribe, () => pending);
  const loadRequested = useRef<{
    readonly request: JumpRequest;
    readonly entries: Parameters<typeof nextJumpStep>[0]["entries"];
  } | null>(null);
  const { threadKey, rows, entries, history, listRef, navigate } = input;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the virtual list's scroll and history paging for a jump the Pinned tab asked for
  useEffect(() => {
    if (request === null || request.threadKey !== threadKey) return;
    const step = nextJumpStep({
      messageId: request.messageId,
      rows,
      entries,
      history,
      load:
        loadRequested.current?.request !== request
          ? "none"
          : loadRequested.current.entries === entries
            ? "pending"
            : "done",
    });
    switch (step.kind) {
      case "wait":
        return;
      case "load-earlier":
        loadRequested.current = { request, entries };
        history?.onLoadEarlier(request.messageId);
        return;
      case "scroll":
        publish(null);
        navigate();
        void listRef.current?.scrollToIndex({
          index: step.rowIndex,
          animated: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          viewOffset: JUMP_VIEW_OFFSET,
        });
        return;
      case "missing":
        publish(null);
        toastManager.add({
          type: "warning",
          title: m(msg("That message is no longer in this thread")),
          description: m(msg("Unpin it from the pinned messages list.")),
        });
        return;
    }
  }, [request, threadKey, rows, entries, history, listRef, navigate]);
}
