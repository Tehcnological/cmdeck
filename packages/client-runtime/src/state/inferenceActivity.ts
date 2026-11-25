import type { InferenceServerId, InferenceServerSnapshot, ThreadId } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** A thread's request held in T3's gateway queue for a busy inference server. */
export interface ThreadInferenceWait {
  readonly serverId: InferenceServerId;
  readonly serverName: string;
  /** Requests the gateway will start before this one. */
  readonly ahead: number;
}

/** The thread's queued request closest to running, or null when none is waiting. */
export function threadInferenceWait(
  servers: ReadonlyArray<InferenceServerSnapshot> | null | undefined,
  threadId: ThreadId,
): ThreadInferenceWait | null {
  let best: ThreadInferenceWait | null = null;
  for (const server of servers ?? []) {
    for (const entry of server.gatewayQueue?.waiting ?? []) {
      if (entry.threadId !== threadId) continue;
      if (best === null || entry.position < best.ahead) {
        best = { serverId: server.id, serverName: server.displayName, ahead: entry.position };
      }
    }
  }
  return best;
}

export function sameThreadInferenceWait(
  a: ThreadInferenceWait | null,
  b: ThreadInferenceWait | null,
): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.serverId === b.serverId &&
      a.serverName === b.serverName &&
      a.ahead === b.ahead)
  );
}

/** "Waiting for rtx · 2 ahead"; "next" once nothing is ahead. */
export function formatThreadInferenceWait(
  wait: ThreadInferenceWait,
  resolve: MFunctionType = mFallback,
): string {
  return resolve(
    msg("Waiting for {server} · {ahead, plural, =0 {next} other {{ahead} ahead}}", {
      server: wait.serverName,
      ahead: wait.ahead,
    }),
  );
}
