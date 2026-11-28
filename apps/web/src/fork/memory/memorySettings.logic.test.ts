import type { MemoryItem, MemoryRevision } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  availableBulkOperations,
  bulkPreviewSummary,
  canRestoreRevision,
  describeRevision,
  selectedItems,
  splitScope,
  toggleAllSelected,
  toggleSelected,
} from "./memorySettings.logic";

const item = (id: string, overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id,
  scope: "project:project-app",
  kind: "fact",
  content: `Item ${id}`,
  provenance: "user_explicit",
  status: "active",
  originThreadId: null,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
  ...overrides,
});

const revision = (before: MemoryItem | null, after: MemoryItem, number = 2): MemoryRevision => ({
  itemId: after.id,
  revision: number,
  actor: "user",
  before,
  after,
  createdAt: after.updatedAt,
});

describe("splitScope", () => {
  it("names the scope's kind and target", () => {
    expect(splitScope("global")).toEqual({ kind: "global", target: null });
    expect(splitScope("project:p-1")).toEqual({ kind: "project", target: "p-1" });
    expect(splitScope("repo:github.com/acme/app")).toEqual({
      kind: "repo",
      target: "github.com/acme/app",
    });
    expect(splitScope("thread:t:1")).toEqual({ kind: "thread", target: "t:1" });
  });
});

describe("availableBulkOperations", () => {
  it("offers only operations that change something", () => {
    expect(availableBulkOperations([])).toEqual([]);
    expect(availableBulkOperations([item("a", { status: "pending" })])).toEqual([
      "accept",
      "retire",
      "replace_text",
    ]);
    expect(availableBulkOperations([item("a")])).toEqual(["retire", "replace_text"]);
    expect(availableBulkOperations([item("a", { status: "retired" })])).toEqual([
      "restore",
      "replace_text",
    ]);
  });
});

describe("selection", () => {
  const items = [item("a"), item("b"), item("c")];

  it("toggles one item and keeps list order", () => {
    const selected = toggleSelected(toggleSelected(new Set(), "c"), "a");
    expect(selectedItems(items, selected).map(({ id }) => id)).toEqual(["a", "c"]);
    expect([...toggleSelected(selected, "a")]).toEqual(["c"]);
  });

  it("drops picks that are no longer listed", () => {
    expect(selectedItems(items, new Set(["a", "gone"])).map(({ id }) => id)).toEqual(["a"]);
  });

  it("selects all, then clears", () => {
    const all = toggleAllSelected(items, new Set(["a"]));
    expect([...all]).toEqual(["a", "b", "c"]);
    expect([...toggleAllSelected(items, all)]).toEqual([]);
  });
});

describe("bulkPreviewSummary", () => {
  it("counts what changes and what stays", () => {
    const before = item("a", { status: "pending" });
    expect(
      bulkPreviewSummary({
        matchedCount: 3,
        changes: [{ before, after: { ...before, status: "active" } }],
      }),
    ).toEqual({ matched: 3, changed: 1, unchanged: 2 });
  });
});

describe("revisions", () => {
  const created = item("a", { status: "pending", provenance: "agent_inferred" });
  const accepted = { ...created, status: "active", provenance: "user_confirmed" } as const;
  const retired = { ...accepted, status: "retired" } as const;

  it("names what each revision did", () => {
    expect(describeRevision(revision(null, created, 1))).toBe("created");
    expect(describeRevision(revision(created, accepted))).toBe("accepted");
    expect(describeRevision(revision(accepted, retired))).toBe("retired");
    expect(describeRevision(revision(retired, accepted))).toBe("restored");
    expect(describeRevision(revision(accepted, { ...accepted, content: "Changed" }))).toBe(
      "edited",
    );
  });

  it("offers restore only where it would change the item", () => {
    expect(canRestoreRevision(revision(null, created, 1), accepted)).toBe(true);
    expect(canRestoreRevision(revision(created, accepted), accepted)).toBe(false);
  });
});
