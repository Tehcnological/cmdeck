import type { MemoryInjection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupInjectionsByRun, memoryModeChip, parseRememberCommand } from "./memoryMode.logic";

describe("memoryModeChip", () => {
  it("names a private mode and offers the way back", () => {
    expect(memoryModeChip("persistent")).toEqual({ showLabel: false, canPromote: false });
    expect(memoryModeChip("incognito")).toEqual({ showLabel: true, canPromote: true });
    expect(memoryModeChip("temporary")).toEqual({ showLabel: true, canPromote: true });
  });
});

describe("parseRememberCommand", () => {
  it("reads the text after /remember at the start of the message", () => {
    expect(parseRememberCommand("/remember use pnpm, not npm")).toBe("use pnpm, not npm");
    expect(parseRememberCommand("  /remember   tabs\nnot spaces ")).toBe("tabs\nnot spaces");
    expect(parseRememberCommand("/remember")).toBe("");
  });

  it("ignores anything that is not the command", () => {
    expect(parseRememberCommand("please /remember this")).toBeNull();
    expect(parseRememberCommand("/rememberthis")).toBeNull();
    expect(parseRememberCommand("/side remember")).toBeNull();
  });
});

describe("groupInjectionsByRun", () => {
  const item = (id: string) => ({
    id,
    scope: "global",
    kind: "rule" as const,
    content: id,
    provenance: "user_explicit" as const,
    status: "active" as const,
    originThreadId: null,
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
  });
  const injection = (runId: string, injectedAt: string, id: string): MemoryInjection => ({
    runId,
    injectedAt,
    item: item(id),
  });

  it("groups each turn's items, newest turn first", () => {
    const runs = groupInjectionsByRun([
      injection("run-1", "2026-11-27T10:00:00.000Z", "a"),
      injection("run-2", "2026-11-27T11:00:00.000Z", "a"),
      injection("run-1", "2026-11-27T10:00:00.000Z", "b"),
    ]);
    expect(runs.map(({ runId, items }) => [runId, items.map(({ id }) => id)])).toEqual([
      ["run-2", ["a"]],
      ["run-1", ["a", "b"]],
    ]);
  });
});
