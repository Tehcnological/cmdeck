import { AuditLogError, CMDECK_WS_METHODS, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as AuditLog from "./AuditLog.ts";

export const handlers = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const audit = yield* Effect.serviceOption(AuditLog.AuditLog);
  const unavailable = Effect.fail(new AuditLogError({}));
  return {
    [CMDECK_WS_METHODS.auditList]: (input) =>
      Option.isSome(audit) ? audit.value.list(input) : unavailable,
    [CMDECK_WS_METHODS.auditVerify]: () =>
      Option.isSome(audit) ? audit.value.verify : unavailable,
  } satisfies ForkRpcModuleHandlers<"audit">;
});
