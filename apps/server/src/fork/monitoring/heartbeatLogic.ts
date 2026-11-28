import type { HeartbeatCheck, HeartbeatCheckKind } from "@t3tools/contracts";

/** One check's result this pass. */
export interface Observation {
  readonly key: string;
  readonly kind: HeartbeatCheckKind;
  readonly label: string;
  readonly up: boolean;
  readonly detail: string | null;
}

export interface HeartbeatAlert {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Compares this pass with what is stored. A check alerts only when it changes between answering
 * and not, so a target that stays down is told once, and once more when it answers again. A
 * running turn that was not responding and then ends counts as recovered; any other check that
 * disappears (a probe removed, a link forgotten) is dropped without a message.
 */
export function heartbeatTransitions(
  stored: ReadonlyArray<HeartbeatCheck>,
  observed: ReadonlyArray<Observation>,
  now: number,
): {
  readonly rows: ReadonlyArray<HeartbeatCheck>;
  readonly removed: ReadonlyArray<string>;
  readonly alerts: ReadonlyArray<HeartbeatAlert>;
} {
  const previous = new Map(stored.map((check) => [check.key, check]));
  const alerts: Array<HeartbeatAlert> = [];
  const rows = observed.map((check): HeartbeatCheck => {
    const before = previous.get(check.key);
    const changed = before === undefined ? !check.up : before.up !== check.up;
    const since = before === undefined || before.up !== check.up ? now : before.since;
    if (changed) alerts.push(alertFor(check, since));
    return { ...check, since, checkedAt: now };
  });
  const seen = new Set(observed.map((check) => check.key));
  const removed = stored.filter((check) => !seen.has(check.key));
  for (const check of removed) {
    if (check.kind === "session" && !check.up) {
      alerts.push(alertFor({ ...check, up: true, detail: "The turn has ended." }, now));
    }
  }
  return { rows, removed: removed.map((check) => check.key), alerts };
}

function alertFor(check: Observation, since: number): HeartbeatAlert {
  return {
    id: `heartbeat:${check.key}:${check.up ? "up" : "down"}:${since}`,
    title: check.up ? `Responding again: ${check.label}` : `Not responding: ${check.label}`,
    body: check.detail ?? (check.up ? "It answers again." : "It stopped answering."),
  };
}
