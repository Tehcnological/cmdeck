import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { msg, T, useGT } from "gt-react";

import { RelativeTime } from "../../components/RelativeTime";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { groupInjectionsByRun } from "./memoryMode.logic";
import { threadMemoryInjections } from "./memoryRpc";

/** The thread panel's "Memory used here" tab: what each turn was given, from memory_injections. */
export function MemoryUsedPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const memoryEnabled = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  if (!memoryEnabled) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <T>Memory is off</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>Turn it on in Settings to give threads what you ask CMDeck to remember.</T>
          </EmptyDescription>
        </EmptyHeader>
        <Button size="sm" variant="outline" render={<Link to="/settings/memory" />}>
          <T>Memory settings</T>
        </Button>
      </Empty>
    );
  }
  return <InjectedMemory environmentId={threadRef.environmentId} threadId={threadRef.threadId} />;
}

function InjectedMemory(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    threadMemoryInjections({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const runs = groupInjectionsByRun(query.data ?? []);

  if (query.error !== null) {
    return <p className="p-4 text-destructive text-sm">{query.error}</p>;
  }
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <T>No memory used yet</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              When a turn of this thread starts with saved memory, the items it was given show here.
            </T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-muted-foreground text-xs">
          <T>
            Saved memory each turn was given, newest first. The thread's messages never hold it.
          </T>
        </p>
        <Button size="xs" variant="ghost" onClick={() => query.refresh()}>
          <T>Refresh</T>
        </Button>
      </div>
      <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {runs.map((run) => (
          <li key={run.runId} className="space-y-1.5">
            <div className="text-muted-foreground text-xs">
              <RelativeTime timestamp={run.injectedAt} />
            </div>
            <ul className="space-y-1.5">
              {run.items.map((item) => (
                <li key={item.id} className="rounded-md border px-2.5 py-2 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge size="sm" variant="secondary">
                      {item.kind === "rule"
                        ? gt("Rule", { $context: "memory item kind" })
                        : gt("Fact", { $context: "memory item kind" })}
                    </Badge>
                    {item.status === "retired" ? (
                      <Badge size="sm" variant="warning">
                        {gt("Retired since", { $context: "memory item retired after this turn" })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{item.content}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="border-t px-3 py-2">
        <Button size="xs" variant="link" render={<Link to="/settings/memory" />}>
          <T>Edit memory in Settings</T>
        </Button>
      </div>
    </div>
  );
}

export const panelTab = {
  id: "memory",
  order: 10,
  title: msg("Memory used here"),
  Content: MemoryUsedPanel,
} as const;
