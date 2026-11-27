import type { ThreadId, WorkItem, WorkItemState, WorkerStatus } from "@t3tools/contracts";

export type BadgeTone = "secondary" | "info" | "success" | "warning" | "error" | "outline";

/** Worker threads still on an open item: the ones archiving the conductor offers to stop. */
export function openWorkerThreadIds(items: ReadonlyArray<WorkItem>): ReadonlyArray<ThreadId> {
  return [
    ...new Set(
      items.flatMap((item) =>
        item.state === "open" && item.workerThreadId !== null ? [item.workerThreadId] : [],
      ),
    ),
  ];
}

export function stateTone(state: WorkItemState): BadgeTone {
  switch (state) {
    case "open":
      return "outline";
    case "accepted":
      return "success";
    case "rejected":
      return "error";
    case "abandoned":
      return "secondary";
  }
}

export function statusTone(status: WorkerStatus): BadgeTone {
  switch (status) {
    case "progress":
      return "info";
    case "done":
      return "success";
    case "blocked":
      return "warning";
    case "question":
      return "warning";
  }
}

/** Open items first, then settled ones, each oldest first as the ledger returns them. */
export function orderForDisplay(items: ReadonlyArray<WorkItem>): ReadonlyArray<WorkItem> {
  return [
    ...items.filter((item) => item.state === "open"),
    ...items.filter((item) => item.state !== "open"),
  ];
}

export function artifactEntries(
  artifacts: WorkItem["artifacts"],
): ReadonlyArray<readonly [string, string]> {
  return Object.entries(artifacts).toSorted(([left], [right]) => left.localeCompare(right));
}
