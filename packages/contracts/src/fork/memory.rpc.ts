import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  MemoryBulkEditInput,
  MemoryBulkEditResult,
  MemoryEditInput,
  MemoryEmbeddingsStatus,
  MemoryInjection,
  MemoryItem,
  MemoryItemIdInput,
  MemoryListInput,
  MemoryRememberInput,
  MemoryRevertInput,
  MemoryRevision,
  MemoryRpcError,
  SetThreadMemoryModeInput,
  ThreadMemoryMode,
  ThreadMemoryModeInput,
} from "./memory.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  memoryList: "cmdeck.memory.list",
  memoryRevisions: "cmdeck.memory.revisions",
  memoryEdit: "cmdeck.memory.edit",
  memoryRevert: "cmdeck.memory.revert",
  memoryPreviewEdit: "cmdeck.memory.previewEdit",
  memoryApplyEdit: "cmdeck.memory.applyEdit",
  memoryRemember: "cmdeck.memory.remember",
  memoryThreadMode: "cmdeck.memory.threadMode",
  memorySetThreadMode: "cmdeck.memory.setThreadMode",
  memoryInjections: "cmdeck.memory.injections",
  memoryEmbeddingsStatus: "cmdeck.memory.embeddingsStatus",
} as const;

const MemoryError = Schema.Union([MemoryRpcError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.memoryList, {
    payload: MemoryListInput,
    success: Schema.Array(MemoryItem),
    error: MemoryError,
  }),
  Rpc.make(methods.memoryRevisions, {
    payload: MemoryItemIdInput,
    success: Schema.Array(MemoryRevision),
    error: MemoryError,
  }),
  Rpc.make(methods.memoryEdit, {
    payload: MemoryEditInput,
    success: MemoryItem,
    error: MemoryError,
  }),
  Rpc.make(methods.memoryRevert, {
    payload: MemoryRevertInput,
    success: MemoryItem,
    error: MemoryError,
  }),
  Rpc.make(methods.memoryPreviewEdit, {
    payload: MemoryBulkEditInput,
    success: MemoryBulkEditResult,
    error: MemoryError,
  }),
  Rpc.make(methods.memoryApplyEdit, {
    payload: MemoryBulkEditInput,
    success: MemoryBulkEditResult,
    error: MemoryError,
  }),
  Rpc.make(methods.memoryRemember, {
    payload: MemoryRememberInput,
    success: MemoryItem,
    error: MemoryError,
  }),
  Rpc.make(methods.memoryThreadMode, {
    payload: ThreadMemoryModeInput,
    success: Schema.Struct({ mode: ThreadMemoryMode }),
    error: MemoryError,
  }),
  Rpc.make(methods.memorySetThreadMode, {
    payload: SetThreadMemoryModeInput,
    success: Schema.Struct({ mode: ThreadMemoryMode }),
    error: MemoryError,
  }),
  Rpc.make(methods.memoryInjections, {
    payload: ThreadMemoryModeInput,
    success: Schema.Array(MemoryInjection),
    error: MemoryError,
  }),
  Rpc.make(methods.memoryEmbeddingsStatus, {
    payload: Schema.Struct({}),
    success: MemoryEmbeddingsStatus,
    error: EnvironmentAuthorizationError,
  }),
] as const;

export const readScopes = {
  [methods.memoryList]: AuthOrchestrationReadScope,
  [methods.memoryRevisions]: AuthOrchestrationReadScope,
  [methods.memoryPreviewEdit]: AuthOrchestrationReadScope,
  [methods.memoryThreadMode]: AuthOrchestrationReadScope,
  [methods.memoryInjections]: AuthOrchestrationReadScope,
  [methods.memoryEmbeddingsStatus]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Memory is what agents are told every turn, so changing it is a settings write.
  [methods.memoryEdit]: AuthSettingsWriteScope,
  [methods.memoryRevert]: AuthSettingsWriteScope,
  [methods.memoryApplyEdit]: AuthSettingsWriteScope,
  // Acting in one thread, as sending it a message does.
  [methods.memoryRemember]: AuthOrchestrationOperateScope,
  [methods.memorySetThreadMode]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
