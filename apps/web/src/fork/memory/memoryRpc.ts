import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

export const memoryList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-list",
  tag: CMDECK_WS_METHODS.memoryList,
  staleTimeMs: 0,
});

export const memoryRevisions = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-revisions",
  tag: CMDECK_WS_METHODS.memoryRevisions,
  staleTimeMs: 0,
});

export const threadMemoryMode = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-thread-mode",
  tag: CMDECK_WS_METHODS.memoryThreadMode,
  staleTimeMs: 0,
});

export const threadMemoryInjections = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-injections",
  tag: CMDECK_WS_METHODS.memoryInjections,
  staleTimeMs: 0,
});

export const editMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-edit",
  tag: CMDECK_WS_METHODS.memoryEdit,
});

export const revertMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-revert",
  tag: CMDECK_WS_METHODS.memoryRevert,
});

/** A bulk edit's preview: it writes nothing, so it is read like any other query. */
export const memoryEditPreview = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-preview-edit",
  tag: CMDECK_WS_METHODS.memoryPreviewEdit,
  staleTimeMs: 0,
});

export const applyMemoryEdit = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-apply-edit",
  tag: CMDECK_WS_METHODS.memoryApplyEdit,
});

export const rememberMemory = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-remember",
  tag: CMDECK_WS_METHODS.memoryRemember,
});

export const setThreadMemoryMode = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-set-thread-mode",
  tag: CMDECK_WS_METHODS.memorySetThreadMode,
});
