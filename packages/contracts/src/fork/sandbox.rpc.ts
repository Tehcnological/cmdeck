import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import type { ForkRpcScopes } from "./rpc.ts";
import {
  SandboxConfigureInput,
  SandboxError,
  SandboxStatus,
  SandboxStatusInput,
} from "./sandbox.ts";

export const methods = {
  sandboxStatus: "cmdeck.sandbox.status",
  sandboxConfigure: "cmdeck.sandbox.configure",
} as const;

export const rpcs = [
  Rpc.make(methods.sandboxStatus, {
    payload: SandboxStatusInput,
    success: SandboxStatus,
    error: Schema.Union([SandboxError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(methods.sandboxConfigure, {
    payload: SandboxConfigureInput,
    success: SandboxStatus,
    error: Schema.Union([SandboxError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {
  [methods.sandboxStatus]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Turning a container off lets agents reach the host, so only a settings writer changes it.
  [methods.sandboxConfigure]: AuthSettingsWriteScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
