import { requestGuarded } from "@t3tools/client-runtime/rpc";
import { CMDECK_WS_METHODS, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";

import { connectionAtomRuntime } from "../connection/runtime";
import { m } from "../i18n/messages";
import { readLocalApi } from "../localApi";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { openWorkerThreadIds } from "./workLedger.logic";

export const listWorkLedger = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:work-ledger-list",
  tag: CMDECK_WS_METHODS.workLedgerList,
});

/**
 * The thread's ledger. `revision` names the conductor's run state, so the ledger is read again
 * whenever the conductor wakes, which is when its workers report back.
 */
export const workLedgerQuery = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:work-ledger",
  staleTimeMs: 0,
  execute: (input: { readonly threadId: ThreadId; readonly revision: string }) =>
    requestGuarded(CMDECK_WS_METHODS.workLedgerList, { threadId: input.threadId }),
});

export const setConductor = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:work-ledger-set-conductor",
  tag: CMDECK_WS_METHODS.workLedgerSetConductor,
});

const stopConductorWorkers = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:work-ledger-stop-workers",
  tag: CMDECK_WS_METHODS.workLedgerStopWorkers,
});

/**
 * Before a conductor is archived, offers to stop the workers still on its open items. Archiving
 * goes ahead either way; the server still refuses it while a delegated worker runs.
 */
export async function offerToStopConductorWorkers(threadRef: ScopedThreadRef): Promise<void> {
  const localApi = readLocalApi();
  if (localApi === undefined) return;
  const ledger = await runAtomCommand(
    appAtomRegistry,
    listWorkLedger,
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } },
    { reportFailure: false },
  );
  if (ledger._tag === "Failure") return;
  const count = openWorkerThreadIds(ledger.value.items).length;
  if (count === 0) return;
  const stop = await localApi.dialogs.confirm(
    m(
      msg(
        "{count, plural, one {This conductor has {count} worker on an open item. Stop it before archiving?} other {This conductor has {count} workers on open items. Stop them before archiving?}}",
        { count },
      ),
    ),
    { variant: "destructive" },
  );
  if (!stop) return;
  await runAtomCommand(
    appAtomRegistry,
    stopConductorWorkers,
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId } },
    { reportFailure: true },
  );
}
