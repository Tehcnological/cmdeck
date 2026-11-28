import { useAtomValue } from "@effect/atom-react";
import { isSessionStateFinished, type ScopedThreadRef } from "@t3tools/contracts";
import { msg, T, useGT } from "gt-react";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { RelativeTime } from "../../components/RelativeTime";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { clearSessionState, threadSessionState } from "./sessionStateRpc";

function Field({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

/**
 * The thread's session state card (WI-2.06), read-only apart from Clear. Agent-written fields
 * render as plain text nodes.
 */
export function SessionStatePanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const { environmentId, threadId } = threadRef;
  const query = useEnvironmentQuery(threadSessionState({ environmentId, input: { threadId } }));
  const canClear = useAtomValue(clearSessionState.permissionAtom(environmentId));
  const clear = useAtomCommand(clearSessionState);
  const { refresh } = query;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- agents rewrite the card between turns, so the server is read again whenever the tab or the window comes back into view
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
  const card = query.data ?? null;
  if (card === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <T>No state card</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              An agent saves one during long-running work. It is shown to the agent on scheduled,
              interval and webhook runs and after the conversation is compacted.
            </T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const finished = isSessionStateFinished(card.phase);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-muted-foreground text-xs">
        <span className="min-w-0 flex-1 truncate">
          <T>Updated</T> <RelativeTime timestamp={card.updatedAt} />
          {" · "}
          {card.injectedAt === null ? (
            <T>not shown to the agent yet</T>
          ) : (
            <>
              <T>shown to the agent</T> <RelativeTime timestamp={card.injectedAt} />
            </>
          )}
        </span>
        {canClear ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void clear({ environmentId, input: { threadId } }).then(refresh)}
          >
            <T>Clear</T>
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label={gt("Refresh")} onClick={() => refresh()}>
          <RefreshCwIcon />
        </Button>
      </div>
      <dl className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {card.goal === "" ? null : <Field label={<T>Goal</T>}>{card.goal}</Field>}
        {card.phase === "" ? null : (
          <Field label={<T>Phase</T>}>
            {card.phase}{" "}
            {finished ? (
              <Badge variant="outline" size="sm">
                <T>finished, no longer shown</T>
              </Badge>
            ) : null}
          </Field>
        )}
        {card.next === "" ? null : <Field label={<T>Next step</T>}>{card.next}</Field>}
        {card.tried.length === 0 ? null : (
          <Field label={<T>Tried and rejected</T>}>
            <ul className="list-disc space-y-1 ps-4">
              {card.tried.toReversed().map((tried, index) => (
                <li key={`${card.tried.length - index}`}>
                  {tried.approach}
                  {tried.rejectedBecause === "" ? null : (
                    <span className="text-muted-foreground"> ({tried.rejectedBecause})</span>
                  )}
                </li>
              ))}
            </ul>
          </Field>
        )}
      </dl>
    </div>
  );
}

export const panelTab = {
  id: "sessionState",
  order: 40,
  title: msg("State card"),
  Content: SessionStatePanel,
} as const;
