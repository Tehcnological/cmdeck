import { CMDECK_WS_METHODS, DecisionsError, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Decisions } from "./Decisions.ts";

export const handlers = Effect.gen(function* () {
  const decisions = yield* Effect.serviceOption(Decisions);
  const noDecisions = Effect.fail(
    new DecisionsError({ detail: "The decision service is not available." }),
  );
  return {
    [CMDECK_WS_METHODS.decisionsStatus]: () =>
      Option.isSome(decisions) ? decisions.value.status : noDecisions,
    [CMDECK_WS_METHODS.decisionsSetConsent]: (input) =>
      // Lessons opt a project in through `cmdeck.lessons.setProject`, which also starts its worker.
      input.point === "lessons"
        ? Effect.fail(new DecisionsError({ detail: "Turn lessons on per project instead." }))
        : Option.isSome(decisions)
          ? decisions.value.setConsent(input)
          : noDecisions,
  } satisfies ForkRpcModuleHandlers<"decisions">;
});
