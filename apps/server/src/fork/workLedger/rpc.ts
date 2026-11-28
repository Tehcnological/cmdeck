import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers, WorkLedgerError } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { stopWorkers } from "./stopWorkers.ts";
import * as WorkLedger from "./WorkLedger.ts";

export const handlers = Effect.gen(function* () {
  const ledger = yield* Effect.serviceOption(WorkLedger.WorkLedger);
  const threads = yield* Effect.serviceOption(ThreadManagement.ThreadManagementService);
  const random = yield* Effect.serviceOption(SecureRandom.SecureRandom);
  const noLedger = Effect.fail(
    new WorkLedgerError({ reason: "The work ledger is not available." }),
  );
  const ledgerFailure = (error: WorkLedger.WorkLedgerStoreError) =>
    new WorkLedgerError({ reason: error.message });
  return {
    [CMDECK_WS_METHODS.workLedgerList]: (input) =>
      Option.isSome(ledger)
        ? Effect.all({
            conductor: ledger.value.isConductor(input.threadId),
            items: ledger.value.list(input.threadId),
          }).pipe(Effect.mapError(ledgerFailure))
        : noLedger,
    [CMDECK_WS_METHODS.workLedgerSetConductor]: (input) =>
      Option.isSome(ledger)
        ? ledger.value
            .setConductor(input.threadId, input.conductor)
            .pipe(Effect.mapError(ledgerFailure))
        : noLedger,
    [CMDECK_WS_METHODS.workLedgerStopWorkers]: (input) =>
      Option.isSome(ledger) && Option.isSome(threads) && Option.isSome(random)
        ? stopWorkers(ledger.value, threads.value, random.value, input.threadId)
        : noLedger,
  } satisfies ForkRpcModuleHandlers<"workLedger">;
});
