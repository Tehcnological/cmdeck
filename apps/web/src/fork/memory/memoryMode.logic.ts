import type { MemoryInjection, MemoryKind, ThreadMemoryMode } from "@t3tools/contracts";

/**
 * How the composer chip shows a thread's mode. Persistent is the default, so the chip stays
 * an icon; incognito and temporary name themselves and offer the way back.
 */
// Ported from KiroCrew@b75544f0 website/src/components/MemoryModeChip.tsx (Apache-2.0):
// an ephemeral mode is the marked state and its chip offers the return to persistent.
export function memoryModeChip(mode: ThreadMemoryMode): {
  readonly showLabel: boolean;
  readonly canPromote: boolean;
} {
  const ephemeral = mode !== "persistent";
  return { showLabel: ephemeral, canPromote: ephemeral };
}

const REMEMBER_COMMAND = /^\/remember(?:\s+([\s\S]*))?$/u;

/**
 * `/remember <text>` at the start of the message: the text to save, or "" when the command has
 * none yet. Anything else is not the command.
 */
export function parseRememberCommand(prompt: string): string | null {
  const match = REMEMBER_COMMAND.exec(prompt.trim());
  if (match === null) return null;
  return (match[1] ?? "").trim();
}

/** `/remember` saves a standing rule: the person asked for it to apply from now on. */
export const REMEMBER_KIND: MemoryKind = "rule";

export interface InjectedRun {
  readonly runId: string;
  readonly injectedAt: string;
  readonly items: ReadonlyArray<MemoryInjection["item"]>;
}

/** Injections grouped by the turn that received them, newest turn first. */
export function groupInjectionsByRun(
  injections: ReadonlyArray<MemoryInjection>,
): ReadonlyArray<InjectedRun> {
  const runs: Array<{ runId: string; injectedAt: string; items: Array<MemoryInjection["item"]> }> =
    [];
  const byRun = new Map<string, (typeof runs)[number]>();
  for (const injection of injections) {
    let run = byRun.get(injection.runId);
    if (run === undefined) {
      run = { runId: injection.runId, injectedAt: injection.injectedAt, items: [] };
      byRun.set(injection.runId, run);
      runs.push(run);
    }
    run.items.push(injection.item);
  }
  return runs.toSorted((left, right) => right.injectedAt.localeCompare(left.injectedAt));
}
