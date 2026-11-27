import { requestGuarded } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type MessagePinsListInput } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

/** One thread's pins; every message row and the Pinned tab of that thread share it. */
export const threadMessagePins = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-pins",
  execute: (input: MessagePinsListInput) =>
    requestGuarded(CMDECK_WS_METHODS.messagePinsList, input),
});

export const pinMessage = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-pin",
  tag: CMDECK_WS_METHODS.messagePinsPin,
});

export const unpinMessage = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:message-unpin",
  tag: CMDECK_WS_METHODS.messagePinsUnpin,
});
