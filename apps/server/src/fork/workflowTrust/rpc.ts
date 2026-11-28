import {
  CMDECK_WS_METHODS,
  type ForkRpcModuleHandlers,
  WorkflowTrustError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { WorkflowDefinitions } from "../../workflows/WorkflowRuntime.ts";
import { installPreset } from "../presets/install.ts";
import { WorkflowTrust } from "./WorkflowTrust.ts";

export const handlers = Effect.gen(function* () {
  const trust = yield* Effect.serviceOption(WorkflowTrust);
  const definitions = yield* Effect.serviceOption(WorkflowDefinitions);
  const noTrust = Effect.fail(new WorkflowTrustError({ reason: "Workflows are not available." }));
  return {
    [CMDECK_WS_METHODS.workflowTrustPending]: () =>
      Option.isSome(trust) ? Effect.map(trust.value.pending, (files) => ({ files })) : noTrust,
    [CMDECK_WS_METHODS.workflowTrustApprove]: (input) =>
      Option.isSome(trust) ? Effect.as(trust.value.approve(input.path, input.sha256), {}) : noTrust,
    [CMDECK_WS_METHODS.workflowPresetInstall]: (input) =>
      Option.isSome(trust) && Option.isSome(definitions)
        ? installPreset(trust.value, definitions.value, input.id)
        : noTrust,
  } satisfies ForkRpcModuleHandlers<"workflowTrust">;
});
