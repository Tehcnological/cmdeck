import { ThreadId, type WorkItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { cmdeckSurface, decodeCmdeckSurface } from "./panelSurface";
import { artifactEntries, openWorkerThreadIds, orderForDisplay } from "./workLedger.logic";

const item = (overrides: Partial<WorkItem>): WorkItem => ({
  id: "it_00000001",
  conductorThreadId: ThreadId.make("conductor"),
  workerThreadId: null,
  title: "Fix the flaky test",
  acceptance: "CI is green",
  state: "open",
  decision: null,
  status: null,
  summary: null,
  artifacts: {},
  pr: null,
  reportedAt: null,
  createdAt: "2026-11-27T10:00:00.000Z",
  updatedAt: "2026-11-27T10:00:00.000Z",
  ...overrides,
});

describe("work ledger panel logic", () => {
  it("offers to stop only workers still on open items, once each", () => {
    const worker = ThreadId.make("worker-1");
    const items = [
      item({ id: "it_00000001", workerThreadId: worker }),
      item({ id: "it_00000002", workerThreadId: worker, state: "accepted" }),
      item({ id: "it_00000003", workerThreadId: ThreadId.make("worker-2"), state: "abandoned" }),
      item({ id: "it_00000004" }),
    ];
    expect(openWorkerThreadIds(items)).toEqual([worker]);
    expect(openWorkerThreadIds([])).toEqual([]);
  });

  it("lists open items before settled ones", () => {
    const ordered = orderForDisplay([
      item({ id: "it_00000001", state: "accepted" }),
      item({ id: "it_00000002" }),
      item({ id: "it_00000003", state: "rejected" }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["it_00000002", "it_00000001", "it_00000003"]);
  });

  it("sorts artifacts by key", () => {
    expect(artifactEntries({ path: "a.ts", branch: "fix/x" })).toEqual([
      ["branch", "fix/x"],
      ["path", "a.ts"],
    ]);
  });

  it("restores a saved ledger tab and drops a panel this build does not have", () => {
    expect(decodeCmdeckSurface({ kind: "cmdeck", panel: "work-ledger" })).toEqual([
      cmdeckSurface("work-ledger"),
    ]);
    expect(decodeCmdeckSurface({ kind: "cmdeck", panel: "from-a-newer-build" })).toEqual([]);
  });
});
