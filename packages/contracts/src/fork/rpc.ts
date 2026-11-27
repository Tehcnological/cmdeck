import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthFilesystemReadScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthSettingsWriteScope,
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
  BotCreateInput,
  BotIdInput,
  BotProfile,
  BotScheduleInput,
  BotsError,
  BotUpdateInput,
  BotWakeResult,
} from "./bots.ts";

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
  botsList: "cmdeck.bots.list",
  botsCreate: "cmdeck.bots.create",
  botsUpdate: "cmdeck.bots.update",
  botsDelete: "cmdeck.bots.delete",
  botsRestore: "cmdeck.bots.restore",
  botsSchedule: "cmdeck.bots.schedule",
  botsWake: "cmdeck.bots.wake",
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

const BotsRpcError = Schema.Union([BotsError, EnvironmentAuthorizationError]);

const CmdeckBotsListRpc = Rpc.make(CMDECK_WS_METHODS.botsList, {
  payload: Schema.Struct({}),
  success: Schema.Array(BotProfile),
  error: BotsRpcError,
});

const CmdeckBotsCreateRpc = Rpc.make(CMDECK_WS_METHODS.botsCreate, {
  payload: BotCreateInput,
  success: BotProfile,
  error: BotsRpcError,
});

const CmdeckBotsUpdateRpc = Rpc.make(CMDECK_WS_METHODS.botsUpdate, {
  payload: BotUpdateInput,
  success: BotProfile,
  error: BotsRpcError,
});

const CmdeckBotsDeleteRpc = Rpc.make(CMDECK_WS_METHODS.botsDelete, {
  payload: BotIdInput,
  success: BotProfile,
  error: BotsRpcError,
});

const CmdeckBotsRestoreRpc = Rpc.make(CMDECK_WS_METHODS.botsRestore, {
  payload: BotIdInput,
  success: BotProfile,
  error: BotsRpcError,
});

const CmdeckBotsScheduleRpc = Rpc.make(CMDECK_WS_METHODS.botsSchedule, {
  payload: BotScheduleInput,
  success: BotProfile,
  error: BotsRpcError,
});

const CmdeckBotsWakeRpc = Rpc.make(CMDECK_WS_METHODS.botsWake, {
  payload: BotIdInput,
  success: BotWakeResult,
  error: BotsRpcError,
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
  CmdeckBotsListRpc,
  CmdeckBotsCreateRpc,
  CmdeckBotsUpdateRpc,
  CmdeckBotsDeleteRpc,
  CmdeckBotsRestoreRpc,
  CmdeckBotsScheduleRpc,
  CmdeckBotsWakeRpc,
);

/** Spread into `CLIENT_GUARDED_RPC_SCOPES`; every fork method needs one. */
export const FORK_RPC_SCOPES = {
  [CMDECK_WS_METHODS.status]: AuthOrchestrationReadScope,
  // Entries are access records (pairings, tokens, secret reveals), so they need access scope.
  [CMDECK_WS_METHODS.auditList]: AuthAccessReadScope,
  [CMDECK_WS_METHODS.auditVerify]: AuthAccessReadScope,
  // Returns each file's source, as reading a definition does.
  [CMDECK_WS_METHODS.workflowTrustPending]: AuthFilesystemReadScope,
  // Approving or installing a file lets the server run it, as saving one in the editor does.
  [CMDECK_WS_METHODS.workflowTrustApprove]: AuthTerminalOperateScope,
  [CMDECK_WS_METHODS.workflowPresetInstall]: AuthTerminalOperateScope,
  [CMDECK_WS_METHODS.notificationChannelsList]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.notificationChannelsSetEnabled]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.notificationChannelsRemove]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.notificationsSubscribeAlerts]: AuthOrchestrationReadScope,
  [CMDECK_WS_METHODS.decisionsStatus]: AuthOrchestrationReadScope,
  // Consent decides whether turn text may reach a model API, so only a settings writer grants it.
  [CMDECK_WS_METHODS.decisionsSetConsent]: AuthSettingsWriteScope,
  [CMDECK_WS_METHODS.botsList]: AuthOrchestrationReadScope,
  // A bot is a thread plus scheduled tasks, so changing one needs what those commands need.
  [CMDECK_WS_METHODS.botsCreate]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.botsUpdate]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.botsDelete]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.botsRestore]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.botsSchedule]: AuthOrchestrationOperateScope,
  [CMDECK_WS_METHODS.botsWake]: AuthOrchestrationOperateScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof ForkWsRpcGroup>["_tag"], AuthEnvironmentScope>;
