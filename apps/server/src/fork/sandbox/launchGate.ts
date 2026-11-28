// Fork-only. Refuses a provider session a sandboxed thread could not run in its container (WI-2.18).
import type { ProviderInstanceId, ProviderSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProviderSessionOpenError } from "../../orchestration-v2/ProviderSessionManager.ts";
import { ContainerSandbox } from "./ContainerSandbox.ts";

/**
 * Providers that never launch through AgentScope, or share one process across threads, would run
 * a sandboxed thread on the host. Refusing here keeps the container a boundary, not a preference.
 */
export const sandboxLaunchGate = Effect.fn("sandboxLaunchGate")(function* <E>(
  input: {
    readonly threadId: string;
    readonly providerSessionId: ProviderSessionId;
    readonly modelSelection: { readonly instanceId: ProviderInstanceId };
  },
  registry: {
    readonly get: (instanceId: ProviderInstanceId) => Effect.Effect<{ readonly driver: string }, E>;
  },
) {
  const sandbox = yield* Effect.serviceOption(ContainerSandbox);
  if (Option.isNone(sandbox) || !(yield* sandbox.value.isSandboxed(input.threadId))) return;
  const driver = yield* registry.get(input.modelSelection.instanceId).pipe(
    Effect.map((adapter) => adapter.driver),
    Effect.orElseSucceed(() => "this provider"),
  );
  const refusal = yield* sandbox.value.launchRefusal(input.threadId, driver);
  if (refusal === null) return;
  return yield* new ProviderSessionOpenError({
    instanceId: input.modelSelection.instanceId,
    providerSessionId: input.providerSessionId,
    cause: refusal,
  });
});
