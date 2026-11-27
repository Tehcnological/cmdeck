import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthFilesystemReadScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
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

// The `cmdeck.` prefix keeps fork methods clear of upstream's names. Append new methods here.
export const CMDECK_WS_METHODS = {
  status: "cmdeck.status",
  auditList: "cmdeck.audit.list",
  auditVerify: "cmdeck.audit.verify",
  workflowTrustPending: "cmdeck.workflowTrust.pending",
  workflowTrustApprove: "cmdeck.workflowTrust.approve",
  workflowPresetInstall: "cmdeck.workflowPreset.install",
} as const;

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

/** Merged into `WsRpcGroup`, so fork methods share its scope middleware. */
export const ForkWsRpcGroup = RpcGroup.make(
  CmdeckStatusRpc,
  CmdeckAuditListRpc,
  CmdeckAuditVerifyRpc,
  CmdeckWorkflowTrustPendingRpc,
  CmdeckWorkflowTrustApproveRpc,
  CmdeckWorkflowPresetInstallRpc,
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
} as const satisfies Record<RpcGroup.Rpcs<typeof ForkWsRpcGroup>["_tag"], AuthEnvironmentScope>;
