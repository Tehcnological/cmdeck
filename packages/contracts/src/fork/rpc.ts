import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthFilesystemReadScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthSettingsWriteScope,
  AuthOrchestrationOperateScope,
  type AuthEnvironmentScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { WorkflowDefinitionChangeResult } from "../workflow.ts";
import { AuditListInput, AuditListResult, AuditLogError, AuditVerifyResult } from "./audit.ts";
import {
  WorkflowPresetInstallInput,
  WorkflowTrustApproveInput,
  WorkflowTrustError,
  WorkflowTrustPendingResult,
} from "./workflowTrust.ts";
import {
  ForkAlert,
  NotificationChannel,
  NotificationChannelError,
  NotificationChannelIdInput,
  NotificationChannelSetEnabledInput,
} from "./notifications.ts";
import { DecisionConsentSetInput, DecisionsError, DecisionsStatus } from "./decisions.ts";
import {
  MemoryEditInput,
  MemoryEmbeddingsStatus,
  MemoryInjection,
  MemoryItem,
  MemoryBulkEditInput,
  MemoryBulkEditResult,
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

// The `cmdeck.` prefix keeps fork methods clear of upstream's names. Append new methods here.
export const CMDECK_WS_METHODS = {
  status: "cmdeck.status",
  auditList: "cmdeck.audit.list",
  auditVerify: "cmdeck.audit.verify",
  workflowTrustPending: "cmdeck.workflowTrust.pending",
  workflowTrustApprove: "cmdeck.workflowTrust.approve",
  workflowPresetInstall: "cmdeck.workflowPreset.install",
  notificationChannelsList: "cmdeck.notifications.channels.list",
  notificationChannelsSetEnabled: "cmdeck.notifications.channels.setEnabled",
  notificationChannelsRemove: "cmdeck.notifications.channels.remove",
  notificationsSubscribeAlerts: "cmdeck.notifications.subscribeAlerts",
  decisionsStatus: "cmdeck.decisions.status",
  decisionsSetConsent: "cmdeck.decisions.setConsent",
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

/** Fork stream methods the client runtime subscribes to like upstream's. */
export type CmdeckSubscriptionRpcTag = typeof CMDECK_WS_METHODS.notificationsSubscribeAlerts;

/** Raised when a fork RPC changes incompatibly, so a client can tell which fork methods a server has. */
export const CMDECK_RPC_VERSION = 1;

const CmdeckStatusRpc = Rpc.make(CMDECK_WS_METHODS.status, {
  payload: Schema.Struct({}),
  success: Schema.Struct({ version: Schema.Number }),
  error: EnvironmentAuthorizationError,
});

const CmdeckAuditListRpc = Rpc.make(CMDECK_WS_METHODS.auditList, {
  payload: AuditListInput,
  success: AuditListResult,
  error: Schema.Union([AuditLogError, EnvironmentAuthorizationError]),
});

const CmdeckAuditVerifyRpc = Rpc.make(CMDECK_WS_METHODS.auditVerify, {
  payload: Schema.Struct({}),
  success: AuditVerifyResult,
  error: Schema.Union([AuditLogError, EnvironmentAuthorizationError]),
});

const CmdeckWorkflowTrustPendingRpc = Rpc.make(CMDECK_WS_METHODS.workflowTrustPending, {
  payload: Schema.Struct({}),
  success: WorkflowTrustPendingResult,
  error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
});

const CmdeckWorkflowTrustApproveRpc = Rpc.make(CMDECK_WS_METHODS.workflowTrustApprove, {
  payload: WorkflowTrustApproveInput,
  success: Schema.Struct({}),
  error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
});

const CmdeckWorkflowPresetInstallRpc = Rpc.make(CMDECK_WS_METHODS.workflowPresetInstall, {
  payload: WorkflowPresetInstallInput,
  success: WorkflowDefinitionChangeResult,
  error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
});
const NotificationChannelsError = Schema.Union([
  NotificationChannelError,
  EnvironmentAuthorizationError,
]);

const CmdeckNotificationChannelsListRpc = Rpc.make(CMDECK_WS_METHODS.notificationChannelsList, {
  payload: Schema.Struct({}),
  success: Schema.Array(NotificationChannel),
  error: NotificationChannelsError,
});

const CmdeckNotificationChannelsSetEnabledRpc = Rpc.make(
  CMDECK_WS_METHODS.notificationChannelsSetEnabled,
  { payload: NotificationChannelSetEnabledInput, error: NotificationChannelsError },
);

const CmdeckNotificationChannelsRemoveRpc = Rpc.make(CMDECK_WS_METHODS.notificationChannelsRemove, {
  payload: NotificationChannelIdInput,
  error: NotificationChannelsError,
});

const CmdeckNotificationsSubscribeAlertsRpc = Rpc.make(
  CMDECK_WS_METHODS.notificationsSubscribeAlerts,
  {
    payload: Schema.Struct({}),
    success: ForkAlert,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

const CmdeckDecisionsStatusRpc = Rpc.make(CMDECK_WS_METHODS.decisionsStatus, {
  payload: Schema.Struct({}),
  success: DecisionsStatus,
  error: Schema.Union([DecisionsError, EnvironmentAuthorizationError]),
});

const CmdeckDecisionsSetConsentRpc = Rpc.make(CMDECK_WS_METHODS.decisionsSetConsent, {
  payload: DecisionConsentSetInput,
  error: Schema.Union([DecisionsError, EnvironmentAuthorizationError]),
});

const MemoryError = Schema.Union([MemoryRpcError, EnvironmentAuthorizationError]);

const CmdeckMemoryListRpc = Rpc.make(CMDECK_WS_METHODS.memoryList, {
  payload: MemoryListInput,
  success: Schema.Array(MemoryItem),
  error: MemoryError,
});

const CmdeckMemoryRevisionsRpc = Rpc.make(CMDECK_WS_METHODS.memoryRevisions, {
  payload: MemoryItemIdInput,
  success: Schema.Array(MemoryRevision),
  error: MemoryError,
});

const CmdeckMemoryEditRpc = Rpc.make(CMDECK_WS_METHODS.memoryEdit, {
  payload: MemoryEditInput,
  success: MemoryItem,
  error: MemoryError,
});

const CmdeckMemoryRevertRpc = Rpc.make(CMDECK_WS_METHODS.memoryRevert, {
  payload: MemoryRevertInput,
  success: MemoryItem,
  error: MemoryError,
});

const CmdeckMemoryPreviewEditRpc = Rpc.make(CMDECK_WS_METHODS.memoryPreviewEdit, {
  payload: MemoryBulkEditInput,
  success: MemoryBulkEditResult,
  error: MemoryError,
});

const CmdeckMemoryApplyEditRpc = Rpc.make(CMDECK_WS_METHODS.memoryApplyEdit, {
  payload: MemoryBulkEditInput,
  success: MemoryBulkEditResult,
  error: MemoryError,
});

const CmdeckMemoryRememberRpc = Rpc.make(CMDECK_WS_METHODS.memoryRemember, {
  payload: MemoryRememberInput,
  success: MemoryItem,
  error: MemoryError,
});

const CmdeckMemoryThreadModeRpc = Rpc.make(CMDECK_WS_METHODS.memoryThreadMode, {
  payload: ThreadMemoryModeInput,
  success: Schema.Struct({ mode: ThreadMemoryMode }),
  error: MemoryError,
});

const CmdeckMemorySetThreadModeRpc = Rpc.make(CMDECK_WS_METHODS.memorySetThreadMode, {
  payload: SetThreadMemoryModeInput,
  success: Schema.Struct({ mode: ThreadMemoryMode }),
  error: MemoryError,
});

const CmdeckMemoryInjectionsRpc = Rpc.make(CMDECK_WS_METHODS.memoryInjections, {
  payload: ThreadMemoryModeInput,
  success: Schema.Array(MemoryInjection),
  error: MemoryError,
});

const CmdeckMemoryEmbeddingsStatusRpc = Rpc.make(CMDECK_WS_METHODS.memoryEmbeddingsStatus, {
  payload: Schema.Struct({}),
  success: MemoryEmbeddingsStatus,
  error: EnvironmentAuthorizationError,
});

/** Merged into `WsRpcGroup`, so fork methods share its scope middleware. */
export const ForkWsRpcGroup = RpcGroup.make(
  CmdeckStatusRpc,
  CmdeckAuditListRpc,
  CmdeckAuditVerifyRpc,
  CmdeckWorkflowTrustPendingRpc,
  CmdeckWorkflowTrustApproveRpc,
  CmdeckWorkflowPresetInstallRpc,
  CmdeckNotificationChannelsListRpc,
  CmdeckNotificationChannelsSetEnabledRpc,
  CmdeckNotificationChannelsRemoveRpc,
  CmdeckNotificationsSubscribeAlertsRpc,
  CmdeckDecisionsStatusRpc,
  CmdeckDecisionsSetConsentRpc,
  CmdeckMemoryListRpc,
  CmdeckMemoryRevisionsRpc,
  CmdeckMemoryEditRpc,
  CmdeckMemoryRevertRpc,
  CmdeckMemoryPreviewEditRpc,
  CmdeckMemoryApplyEditRpc,
  CmdeckMemoryRememberRpc,
  CmdeckMemoryThreadModeRpc,
  CmdeckMemorySetThreadModeRpc,
  CmdeckMemoryInjectionsRpc,
  CmdeckMemoryEmbeddingsStatusRpc,
);

/**
 * Reads: only the server checks these (spread into `RPC_REQUIRED_SCOPES`), like upstream reads, so
 * clients read them with `request` from query atoms. A client-guarded method needs a command
 * boundary, so a guarded read made from a query atom is refused on the client.
 */
export const FORK_RPC_READ_SCOPES = {
  [CMDECK_WS_METHODS.status]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.notificationChannelsList]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.decisionsStatus]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryList]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryRevisions]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryPreviewEdit]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryThreadMode]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryInjections]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.memoryEmbeddingsStatus]: AuthOrchestrationReadScope,
} as const;

type ForkRpcTag = RpcGroup.Rpcs<typeof ForkWsRpcGroup>["_tag"];

/** Spread into `CLIENT_GUARDED_RPC_SCOPES`; every fork method not in the read map needs one. */
export const FORK_RPC_SCOPES = {
  // Entries are access records (pairings, tokens, secret reveals), so they need access scope.
  [CMDECK_WS_METHODS.auditList]: AuthAccessReadScope,
  [CMDECK_WS_METHODS.auditVerify]: AuthAccessReadScope,
  // Returns each file's source, as reading a definition does.
  [CMDECK_WS_METHODS.workflowTrustPending]: AuthFilesystemReadScope,
  // Approving or installing a file lets the server run it, as saving one in the editor does.
  [CMDECK_WS_METHODS.workflowTrustApprove]: AuthTerminalOperateScope,
  [CMDECK_WS_METHODS.workflowPresetInstall]: AuthTerminalOperateScope,
  [CMDECK_WS_METHODS.notificationChannelsSetEnabled]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.notificationChannelsRemove]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.notificationsSubscribeAlerts]: AuthOrchestrationReadScope,
  // Consent decides whether turn text may reach a model API, so only a settings writer grants it.
  [CMDECK_WS_METHODS.decisionsSetConsent]: AuthSettingsWriteScope,
  // Memory is what agents are told every turn, so changing it is a settings write.
  [CMDECK_WS_METHODS.memoryEdit]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.memoryRevert]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.memoryApplyEdit]: AuthSettingsWriteScope,
  // Acting in one thread, as sending it a message does.
  [CMDECK_WS_METHODS.memoryRemember]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.memorySetThreadMode]: AuthOrchestrationOperateScope,
} as const satisfies Record<
  Exclude<ForkRpcTag, keyof typeof FORK_RPC_READ_SCOPES>,
  AuthEnvironmentScope
>;
