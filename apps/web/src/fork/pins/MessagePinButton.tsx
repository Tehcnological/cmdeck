import { useAtomValue } from "@effect/atom-react";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { PinIcon, PinOffIcon } from "lucide-react";

import { Button } from "../../components/ui/button";
import { SharedTooltipTrigger } from "../../components/ui/shared-tooltip";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { isMessagePinned } from "./pins.logic";
import { pinMessage, threadMessagePins, unpinMessage } from "./pinsRpc";

/** Pin or unpin a message from its actions; pins list in the thread's Pinned tab. */
export function MessagePinButton(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly messageId: MessageId;
  /** Only decides whether the button shows; the server reads the message itself. */
  readonly text: string;
}) {
  const { threadRef } = props;
  return threadRef === null || props.text.trim() === "" ? null : (
    <PinToggle threadRef={threadRef} messageId={props.messageId} />
  );
}

function PinToggle(props: { readonly threadRef: ScopedThreadRef; readonly messageId: MessageId }) {
  const gt = useGT();
  const { environmentId, threadId } = props.threadRef;
  const query = useEnvironmentQuery(threadMessagePins({ environmentId, input: { threadId } }));
  const canPin = useAtomValue(pinMessage.permissionAtom(environmentId));
  const pin = useAtomCommand(pinMessage);
  const unpin = useAtomCommand(unpinMessage);
  if (!canPin) return null;
  const pinned = isMessagePinned(query.data, props.messageId);
  const label = pinned ? gt("Unpin message") : gt("Pin message");
  const toggle = () => {
    const done = pinned
      ? unpin({ environmentId, input: { threadId, messageId: props.messageId } })
      : pin({ environmentId, input: { threadId, messageId: props.messageId } });
    void done.then(query.refresh);
  };
  return (
    <SharedTooltipTrigger
      render={
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          onClick={toggle}
          aria-label={label}
          aria-pressed={pinned}
        />
      }
      label={pinned ? <T>Unpin message</T> : <T>Pin message</T>}
    >
      {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
    </SharedTooltipTrigger>
  );
}
