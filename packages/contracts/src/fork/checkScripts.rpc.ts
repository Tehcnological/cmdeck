import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  CheckScriptError,
  ScheduledTaskCheckApproveInput,
  ScheduledTaskCheckListResult,
  ScheduledTaskCheckSetInput,
  ScheduledTaskCheckSetResult,
} from "./checkScripts.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  checkScriptsList: "cmdeck.checkScripts.list",
  checkScriptsSet: "cmdeck.checkScripts.set",
  checkScriptsApprove: "cmdeck.checkScripts.approve",
} as const;

const CheckScriptsError = Schema.Union([CheckScriptError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.checkScriptsList, {
    payload: Schema.Struct({}),
    success: ScheduledTaskCheckListResult,
    error: CheckScriptsError,
  }),
  Rpc.make(methods.checkScriptsSet, {
    payload: ScheduledTaskCheckSetInput,
    success: ScheduledTaskCheckSetResult,
    error: CheckScriptsError,
  }),
  Rpc.make(methods.checkScriptsApprove, {
    payload: ScheduledTaskCheckApproveInput,
    success: Schema.Struct({}),
    error: CheckScriptsError,
  }),
] as const;

export const readScopes = {
  // Scripts are task data, read like prompts.
  [methods.checkScriptsList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Saving or approving a check script lets the server run it.
  [methods.checkScriptsSet]: AuthTerminalOperateScope,
  [methods.checkScriptsApprove]: AuthTerminalOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
