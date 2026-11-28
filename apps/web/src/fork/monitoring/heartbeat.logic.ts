import {
  type HeartbeatProbe,
  MAX_HEARTBEAT_PROBES,
  parseHeartbeatProbeTarget,
} from "@t3tools/contracts";

/** One probe per line, `name = target`; a line with only a target is named after it. */
export function formatProbeLines(probes: ReadonlyArray<HeartbeatProbe>): string {
  return probes
    .map((probe) =>
      probe.name === probe.target ? probe.target : `${probe.name} = ${probe.target}`,
    )
    .join("\n");
}

export type ProbeLinesResult =
  | { readonly ok: true; readonly probes: ReadonlyArray<HeartbeatProbe> }
  | { readonly ok: false; readonly line: number; readonly reason: "target" | "name" | "count" };

export function parseProbeLines(text: string): ProbeLinesResult {
  const probes: Array<HeartbeatProbe> = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const split = line.indexOf("=");
    const name = (split < 0 ? line : line.slice(0, split)).trim();
    const target = (split < 0 ? line : line.slice(split + 1)).trim();
    if (name === "" || name.length > 80) return { ok: false, line: index + 1, reason: "name" };
    if (typeof parseHeartbeatProbeTarget(target) === "string") {
      return { ok: false, line: index + 1, reason: "target" };
    }
    probes.push({ name, target });
  }
  if (probes.length > MAX_HEARTBEAT_PROBES) {
    return { ok: false, line: lines.length, reason: "count" };
  }
  return { ok: true, probes };
}

export const sameProbes = (a: ReadonlyArray<HeartbeatProbe>, b: ReadonlyArray<HeartbeatProbe>) =>
  formatProbeLines(a) === formatProbeLines(b);
