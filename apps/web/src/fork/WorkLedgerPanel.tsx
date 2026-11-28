import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { msg, T, useGT, useMessages } from "gt-react";
import { ListChecksIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useRightPanelStore } from "../rightPanelStore";
import { useQuietThreadShell } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { artifactEntries, orderForDisplay, stateTone, statusTone } from "./workLedger.logic";
import { setConductor, workLedgerQuery } from "./workLedger";

const STATE_LABELS = {
  open: msg("open", { $context: "work item state" }),
  accepted: msg("accepted", { $context: "work item state" }),
  rejected: msg("rejected", { $context: "work item state" }),
  abandoned: msg("abandoned", { $context: "work item state" }),
} as const;

const STATUS_LABELS = {
  progress: msg("in progress", { $context: "worker status" }),
  done: msg("done", { $context: "worker status" }),
  blocked: msg("blocked", { $context: "worker status" }),
  question: msg("question", { $context: "worker status" }),
} as const;

/**
 * The conductor's work items as a list (WI-2.02). Every worker-written field renders as a plain
 * text node: a report is data, never markup or a prompt.
 */
export function WorkLedgerPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const messages = useMessages();
  const { environmentId, threadId } = threadRef;
  const canChange = useAtomValue(setConductor.permissionAtom(environmentId));
  const change = useAtomCommand(setConductor);
  const runtime = useQuietThreadShell(threadRef)?.runtime;
  const query = workLedgerQuery({
    environmentId,
    input: { threadId, revision: `${runtime?.status ?? "idle"}:${runtime?.activeRunId ?? ""}` },
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const ledger = AsyncResult.getOrElse(result, () => null);
  const failed = AsyncResult.isFailure(result);
  const [busy, setBusy] = useState(false);

  const toggleConductor = async (conductor: boolean) => {
    setBusy(true);
    await change({ environmentId, input: { threadId, conductor } });
    setBusy(false);
    refresh();
  };

  const items = orderForDisplay(ledger?.items ?? []);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListChecksIcon className="size-4 text-icon-muted" />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {ledger?.conductor ? <T>Conductor</T> : <T>Not a conductor</T>}
        </span>
        {canChange && ledger !== null ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void toggleConductor(!ledger.conductor)}
          >
            {ledger.conductor ? <T>Stop conducting</T> : <T>Start conductor</T>}
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" aria-label={gt("Refresh")} onClick={() => refresh()}>
          <RefreshCwIcon />
        </Button>
      </div>
      {failed ? (
        <p className="p-4 text-destructive text-sm">
          <T>Could not read the work ledger.</T>
        </p>
      ) : null}
      {ledger !== null && items.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">
          {ledger.conductor ? (
            <T>
              No work items yet. Tell this thread the goal: it plans the items, starts a worker for
              each, and lists them here.
            </T>
          ) : (
            <T>
              Start a conductor to have this thread split a goal into work items, start a worker for
              each, and check what they report.
            </T>
          )}
        </p>
      ) : null}
      <ul className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain">
        {items.map((item) => {
          const workerThreadId = item.workerThreadId;
          return (
            <li key={item.id} className="space-y-1.5 px-3 py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words font-medium">{item.title}</span>
                <Badge variant={stateTone(item.state)} size="sm">
                  {messages(STATE_LABELS[item.state])}
                </Badge>
                {item.status === null ? null : (
                  <Badge variant={statusTone(item.status)} size="sm">
                    {messages(STATUS_LABELS[item.status])}
                  </Badge>
                )}
              </div>
              <p className="break-words text-muted-foreground text-xs">{item.acceptance}</p>
              {item.summary === null ? null : (
                <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2 py-1 text-xs">
                  {item.summary}
                </p>
              )}
              {artifactEntries(item.artifacts).length === 0 && item.pr === null ? null : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 font-mono text-xs">
                  {item.pr === null ? null : (
                    <>
                      <dt className="text-muted-foreground">pr</dt>
                      <dd>#{item.pr}</dd>
                    </>
                  )}
                  {artifactEntries(item.artifacts).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {workerThreadId === null ? null : (
                <Button
                  size="xs"
                  variant="link"
                  onClick={() =>
                    useRightPanelStore.getState().openThread(threadRef, workerThreadId)
                  }
                >
                  <T>Open worker</T>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
