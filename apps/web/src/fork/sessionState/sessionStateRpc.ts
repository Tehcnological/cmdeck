import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

export const threadSessionState = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:session-state",
  tag: CMDECK_WS_METHODS.sessionStateGet,
});

export const clearSessionState = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:session-state-clear",
  tag: CMDECK_WS_METHODS.sessionStateClear,
});
