import type {
  MemoryBulkEditResult,
  MemoryBulkOperation,
  MemoryItem,
  MemoryRevision,
  MemoryScopeKind,
} from "@t3tools/contracts";

/** The scope's kind and what it names: a project id, a repository key, a bot or a thread. */
export function splitScope(scope: string): {
  readonly kind: MemoryScopeKind;
  readonly target: string | null;
} {
  if (scope === "global") return { kind: "global", target: null };
  const colon = scope.indexOf(":");
  const kind = scope.slice(0, colon);
  const target = scope.slice(colon + 1);
  switch (kind) {
    case "project":
    case "repo":
    case "bot":
    case "thread":
      return { kind, target };
    default:
      return { kind: "global", target: null };
  }
}

export type MemoryBulkOperationType = MemoryBulkOperation["type"];

/** The bulk operations that would change at least one of the selected items. */
export function availableBulkOperations(
  selected: ReadonlyArray<MemoryItem>,
): ReadonlyArray<MemoryBulkOperationType> {
  if (selected.length === 0) return [];
  const has = (status: MemoryItem["status"]) => selected.some((item) => item.status === status);
  return [
    ...(has("pending") ? (["accept"] as const) : []),
    ...(has("pending") || has("active") ? (["retire"] as const) : []),
    ...(has("retired") ? (["restore"] as const) : []),
    "replace_text",
  ];
}

/** The selected items that are still listed, in list order, so a refresh drops stale picks. */
export function selectedItems(
  items: ReadonlyArray<MemoryItem>,
  selectedIds: ReadonlySet<string>,
): ReadonlyArray<MemoryItem> {
  return items.filter((item) => selectedIds.has(item.id));
}

export function toggleSelected(selectedIds: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selectedIds);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Selects every listed item, or clears the selection when all are already selected. */
export function toggleAllSelected(
  items: ReadonlyArray<MemoryItem>,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  return allSelected ? new Set() : new Set(items.map((item) => item.id));
}

export interface BulkPreviewSummary {
  readonly matched: number;
  readonly changed: number;
  readonly unchanged: number;
}

// Ported from KiroCrew@b75544f0 src/kiro_crew/memory_edit.py `_preview_response` (Apache-2.0).
export function bulkPreviewSummary(result: MemoryBulkEditResult): BulkPreviewSummary {
  return {
    matched: result.matchedCount,
    changed: result.changes.length,
    unchanged: result.matchedCount - result.changes.length,
  };
}

export type RevisionChange = "created" | "accepted" | "retired" | "restored" | "edited";

// Ported from KiroCrew@b75544f0 src/kiro_crew/memory_edit.py `_operation_label` (Apache-2.0);
// changed to name this store's status changes.
/** What one revision did to the item. */
export function describeRevision(revision: MemoryRevision): RevisionChange {
  const { before, after } = revision;
  if (before === null) return "created";
  if (before.status !== after.status) {
    if (after.status === "retired") return "retired";
    if (before.status === "pending" && after.status === "active") return "accepted";
    return "restored";
  }
  return "edited";
}

/** A revision can be restored when going back to it would change the item. */
export function canRestoreRevision(revision: MemoryRevision, current: MemoryItem): boolean {
  const { after } = revision;
  return (
    after.content !== current.content ||
    after.kind !== current.kind ||
    after.status !== current.status
  );
}
