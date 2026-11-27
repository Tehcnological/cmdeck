import { requestGuarded } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import {
  CMDECK_WS_METHODS,
  type MemoryBulkEditInput,
  type MemoryItemIdInput,
  type MemoryListInput,
  type ThreadMemoryModeInput,
} from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

export const memoryList = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-list",
  staleTimeMs: 0,
  execute: (input: MemoryListInput) => requestGuarded(CMDECK_WS_METHODS.memoryList, input),
});

export const memoryRevisions = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-revisions",
  staleTimeMs: 0,
  execute: (input: MemoryItemIdInput) => requestGuarded(CMDECK_WS_METHODS.memoryRevisions, input),
});

export const threadMemoryMode = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-thread-mode",
  staleTimeMs: 0,
  execute: (input: ThreadMemoryModeInput) =>
    requestGuarded(CMDECK_WS_METHODS.memoryThreadMode, input),
});

export const threadMemoryInjections = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-injections",
  staleTimeMs: 0,
  execute: (input: ThreadMemoryModeInput) =>
    requestGuarded(CMDECK_WS_METHODS.memoryInjections, input),
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
export const memoryEditPreview = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-preview-edit",
  staleTimeMs: 0,
  execute: (input: MemoryBulkEditInput) =>
    requestGuarded(CMDECK_WS_METHODS.memoryPreviewEdit, input),
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
