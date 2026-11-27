import {
  AuditLogError,
  CMDECK_RPC_VERSION,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  WorkflowTrustError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { WorkflowDefinitions } from "../../workflows/WorkflowRuntime.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { installPreset } from "../presets/install.ts";
import { WorkflowTrust } from "../workflowTrust/WorkflowTrust.ts";

/** Spread into the server's WS handlers; each fork module adds its methods here. */
export const make = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const audit = yield* Effect.serviceOption(AuditLog.AuditLog);
  const trust = yield* Effect.serviceOption(WorkflowTrust);
  const definitions = yield* Effect.serviceOption(WorkflowDefinitions);
  const unavailable = Effect.fail(new AuditLogError({}));
  const noTrust = Effect.fail(new WorkflowTrustError({ reason: "Workflows are not available." }));
  return ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
    [CMDECK_WS_METHODS.auditList]: (input) =>
      Option.isSome(audit) ? audit.value.list(input) : unavailable,
    [CMDECK_WS_METHODS.auditVerify]: () =>
      Option.isSome(audit) ? audit.value.verify : unavailable,
    [CMDECK_WS_METHODS.workflowTrustPending]: () =>
      Option.isSome(trust) ? Effect.map(trust.value.pending, (files) => ({ files })) : noTrust,
    [CMDECK_WS_METHODS.workflowTrustApprove]: (input) =>
      Option.isSome(trust) ? Effect.as(trust.value.approve(input.path, input.sha256), {}) : noTrust,
    [CMDECK_WS_METHODS.workflowPresetInstall]: (input) =>
      Option.isSome(trust) && Option.isSome(definitions)
        ? installPreset(trust.value, definitions.value, input.id)
        : noTrust,
  });
});
