import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import { DecisionConsentSetInput, DecisionsError, DecisionsStatus } from "./decisions.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  decisionsStatus: "cmdeck.decisions.status",
  decisionsSetConsent: "cmdeck.decisions.setConsent",
} as const;

export const rpcs = [
  Rpc.make(methods.decisionsStatus, {
    payload: Schema.Struct({}),
    success: DecisionsStatus,
    error: Schema.Union([DecisionsError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(methods.decisionsSetConsent, {
    payload: DecisionConsentSetInput,
    error: Schema.Union([DecisionsError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {
  [methods.decisionsStatus]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // Consent decides whether turn text may reach a model API, so only a settings writer grants it.
  [methods.decisionsSetConsent]: AuthSettingsWriteScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
