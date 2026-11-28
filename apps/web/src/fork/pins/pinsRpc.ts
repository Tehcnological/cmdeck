import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

/** One thread's pins; every message row and the Pinned tab of that thread share it. */
export const threadMessagePins = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-pins",
  tag: CMDECK_WS_METHODS.messagePinsList,
});

export const pinMessage = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-pin",
  tag: CMDECK_WS_METHODS.messagePinsPin,
});

export const unpinMessage = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-unpin",
  tag: CMDECK_WS_METHODS.messagePinsUnpin,
});
