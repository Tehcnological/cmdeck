import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthFilesystemReadScope,
  AuthTerminalOperateScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { WorkflowDefinitionChangeResult } from "../workflow.ts";
import type { ForkRpcScopes } from "./rpc.ts";
import {
  WorkflowPresetInstallInput,
  WorkflowTrustApproveInput,
  WorkflowTrustError,
  WorkflowTrustPendingResult,
} from "./workflowTrust.ts";

export const methods = {
  workflowTrustPending: "cmdeck.workflowTrust.pending",
  workflowTrustApprove: "cmdeck.workflowTrust.approve",
  workflowPresetInstall: "cmdeck.workflowPreset.install",
} as const;

export const rpcs = [
  Rpc.make(methods.workflowTrustPending, {
    payload: Schema.Struct({}),
    success: WorkflowTrustPendingResult,
    error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(methods.workflowTrustApprove, {
    payload: WorkflowTrustApproveInput,
    success: Schema.Struct({}),
    error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(methods.workflowPresetInstall, {
    payload: WorkflowPresetInstallInput,
    success: WorkflowDefinitionChangeResult,
    error: Schema.Union([WorkflowTrustError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {} as const;

export const scopes = {
  // Returns each file's source, as reading a definition does.
  [methods.workflowTrustPending]: AuthFilesystemReadScope,
  // Approving or installing a file lets the server run it, as saving one in the editor does.
  [methods.workflowTrustApprove]: AuthTerminalOperateScope,
  [methods.workflowPresetInstall]: AuthTerminalOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
