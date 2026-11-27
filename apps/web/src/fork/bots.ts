import { requestGuarded } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** One list per environment, shared by the settings section and every sidebar badge. */
export const botList = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bots",
  staleTimeMs: 60_000,
  execute: () => requestGuarded(CMDECK_WS_METHODS.botsList, {}),
});

export const createBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-create",
  tag: CMDECK_WS_METHODS.botsCreate,
});

export const updateBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-update",
  tag: CMDECK_WS_METHODS.botsUpdate,
});

export const deleteBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-delete",
  tag: CMDECK_WS_METHODS.botsDelete,
});

export const restoreBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-restore",
  tag: CMDECK_WS_METHODS.botsRestore,
});

export const scheduleBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-schedule",
  tag: CMDECK_WS_METHODS.botsSchedule,
});

export const wakeBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:bot-wake",
  tag: CMDECK_WS_METHODS.botsWake,
});
