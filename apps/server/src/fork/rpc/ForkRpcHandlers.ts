import {
  AuditLogError,
  CMDECK_RPC_VERSION,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as AuditLog from "../audit/AuditLog.ts";

/** Spread into the server's WS handlers; each fork module adds its methods here. */
export const make = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const audit = yield* Effect.serviceOption(AuditLog.AuditLog);
  const unavailable = Effect.fail(new AuditLogError({}));
  return ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
    [CMDECK_WS_METHODS.auditList]: (input) =>
      Option.isSome(audit) ? audit.value.list(input) : unavailable,
    [CMDECK_WS_METHODS.auditVerify]: () =>
      Option.isSome(audit) ? audit.value.verify : unavailable,
  });
});
