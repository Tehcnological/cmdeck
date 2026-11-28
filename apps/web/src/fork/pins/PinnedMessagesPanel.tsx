import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PinOffIcon } from "lucide-react";
import { useEffect } from "react";

import { RelativeTime } from "../../components/RelativeTime";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { useEnvironmentQuery } from "../../state/query";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { useRightPanelStore } from "../../rightPanelStore";
import { useAtomCommand } from "../../state/use-atom-command";
import { requestMessageJump } from "./messageJump";
import { threadMessagePins, unpinMessage } from "./pinsRpc";

/** The thread panel's Pinned tab: the thread's pinned messages, each a jump back into the chat. */
export function PinnedMessagesPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const { environmentId, threadId } = threadRef;
  const query = useEnvironmentQuery(threadMessagePins({ environmentId, input: { threadId } }));
  const canUnpin = useAtomValue(unpinMessage.permissionAtom(environmentId));
  const unpin = useAtomCommand(unpinMessage);
  const { refresh } = query;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pins change on other clients, so the server is read again whenever the tab or the window comes back into view
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  if (query.error !== null && query.data === null) {
    return <p className="p-4 text-destructive text-sm">{query.error}</p>;
  }
  const pins = query.data ?? [];
  if (pins.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <T>No pinned messages</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>Pin a message from its actions to keep it here and jump back to it.</T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="h-full min-h-0 space-y-1.5 overflow-y-auto p-3">
      {pins.map((pin) => (
        <li key={pin.messageId} className="group flex items-start gap-1 rounded-md border">
          <button
            type="button"
            className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-start hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              // On narrow screens the panel is a sheet over the chat, so it gets out of the way.
              if (window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY).matches) {
                useRightPanelStore.getState().close(threadRef);
              }
              requestMessageJump(threadRef, pin.messageId);
            }}
          >
            <span className="mb-1 flex items-center gap-1.5 text-muted-foreground text-xs">
              <span className="font-medium">
                {pin.role === "user"
                  ? gt("You", { $context: "author of a pinned message" })
                  : gt("Agent", { $context: "author of a pinned message" })}
              </span>
              <span aria-hidden>·</span>
              <RelativeTime timestamp={new Date(pin.pinnedAt).toISOString()} />
            </span>
            <span className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
              {pin.preview}
            </span>
          </button>
          {canUnpin ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              className="m-1 shrink-0"
              aria-label={gt("Unpin message")}
              onClick={() =>
                void unpin({ environmentId, input: { threadId, messageId: pin.messageId } }).then(
                  refresh,
                )
              }
            >
              <PinOffIcon />
            </Button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
