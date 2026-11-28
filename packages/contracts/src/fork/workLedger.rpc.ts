import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import type { ForkRpcScopes } from "./rpc.ts";
import {
  WorkLedgerError,
  WorkLedgerListResult,
  WorkLedgerSetConductorInput,
  WorkLedgerStopWorkersResult,
  WorkLedgerThreadInput,
} from "./workLedger.ts";

export const methods = {
  workLedgerList: "cmdeck.workLedger.list",
  workLedgerSetConductor: "cmdeck.workLedger.setConductor",
  workLedgerStopWorkers: "cmdeck.workLedger.stopWorkers",
} as const;

const WorkLedgerRpcError = Schema.Union([WorkLedgerError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.workLedgerList, {
    payload: WorkLedgerThreadInput,
    success: WorkLedgerListResult,
    error: WorkLedgerRpcError,
  }),
  Rpc.make(methods.workLedgerSetConductor, {
    payload: WorkLedgerSetConductorInput,
    error: WorkLedgerRpcError,
  }),
  Rpc.make(methods.workLedgerStopWorkers, {
    payload: WorkLedgerThreadInput,
    success: WorkLedgerStopWorkersResult,
    error: WorkLedgerRpcError,
  }),
] as const;

export const readScopes = {
  [methods.workLedgerList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Starting or ending a conductor changes what its agent is told on each turn.
  [methods.workLedgerSetConductor]: AuthOrchestrationOperateScope,
  [methods.workLedgerStopWorkers]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
