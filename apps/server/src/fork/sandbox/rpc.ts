import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers, SandboxError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ContainerSandbox } from "./ContainerSandbox.ts";

export const handlers = Effect.gen(function* () {
  const sandbox = yield* Effect.serviceOption(ContainerSandbox);
  const noSandbox = Effect.fail(
    new SandboxError({ detail: "Containers are not available on this server." }),
  );
  return {
    [CMDECK_WS_METHODS.sandboxStatus]: (input) =>
      Option.isSome(sandbox) ? sandbox.value.status(input) : noSandbox,
    [CMDECK_WS_METHODS.sandboxConfigure]: (input) =>
      Option.isSome(sandbox) ? sandbox.value.configure(input, "user") : noSandbox,
  } satisfies ForkRpcModuleHandlers<"sandbox">;
});
