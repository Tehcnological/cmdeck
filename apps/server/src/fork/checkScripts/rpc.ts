import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CheckScripts } from "./CheckScripts.ts";

export const handlers = Effect.gen(function* () {
  const checks = yield* CheckScripts;
  return {
    [CMDECK_WS_METHODS.checkScriptsList]: () =>
      Effect.map(checks.list, (list) => ({ checks: list })),
    [CMDECK_WS_METHODS.checkScriptsSet]: (input) =>
      Effect.map(checks.set({ ...input, by: "user" }), (check) => ({ check })),
    [CMDECK_WS_METHODS.checkScriptsApprove]: (input) => Effect.as(checks.approve(input), {}),
  } satisfies ForkRpcModuleHandlers<"checkScripts">;
});
