import { CommandId, type ThreadId, WorkLedgerError } from "@t3tools/contracts";
import type * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";

import type * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import type * as WorkLedger from "./WorkLedger.ts";

/**
 * Stops a conductor's workers before it is archived: Stop on the conductor stops every task it
 * delegated, then each worker bound to one of its open items is stopped too, for one started
 * some other way. A worker that is already idle or gone is skipped.
 */
export const stopWorkers = Effect.fn("WorkLedger.stopWorkers")(function* (
  ledger: WorkLedger.WorkLedger["Service"],
  threads: ThreadManagement.ThreadManagementService["Service"],
  random: SecureRandom.SecureRandom["Service"],
  conductorThreadId: ThreadId,
) {
  const items = yield* ledger
    .list(conductorThreadId)
    .pipe(Effect.mapError((error) => new WorkLedgerError({ reason: error.message })));
  const workers = [
    ...new Set(
      items.flatMap((item) =>
        item.state === "open" && item.workerThreadId !== null ? [item.workerThreadId] : [],
      ),
    ),
  ];
  const stop = (threadId: ThreadId) =>
    random.uuidV4().pipe(
      Effect.flatMap((uuid) =>
        threads.dispatch({
          type: "thread.stop",
          commandId: CommandId.make(`cmdeck-work-stop:${uuid}`),
          threadId,
          reason: "The user stopped this conductor's workers to archive it.",
        }),
      ),
      Effect.as(true),
      Effect.catchCause((cause) =>
        Effect.logDebug("A conductor's worker could not be stopped", cause).pipe(Effect.as(false)),
      ),
    );
  yield* stop(conductorThreadId);
  const stopped = yield* Effect.forEach(workers, stop);
  return { stopped: stopped.filter(Boolean).length };
});
