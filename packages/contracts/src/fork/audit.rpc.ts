import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { AuthAccessReadScope, EnvironmentAuthorizationError } from "../auth.ts";
import { AuditListInput, AuditListResult, AuditLogError, AuditVerifyResult } from "./audit.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  auditList: "cmdeck.audit.list",
  auditVerify: "cmdeck.audit.verify",
} as const;

export const rpcs = [
  Rpc.make(methods.auditList, {
    payload: AuditListInput,
    success: AuditListResult,
    error: Schema.Union([AuditLogError, EnvironmentAuthorizationError]),
  }),
  Rpc.make(methods.auditVerify, {
    payload: Schema.Struct({}),
    success: AuditVerifyResult,
    error: Schema.Union([AuditLogError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {} as const;

export const scopes = {
  // Entries are access records (pairings, tokens, secret reveals), so they need access scope.
  [methods.auditList]: AuthAccessReadScope,
  [methods.auditVerify]: AuthAccessReadScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
