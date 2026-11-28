import { CMDECK_WS_METHODS, DecisionsError, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Lessons } from "./Lessons.ts";

export const handlers = Effect.gen(function* () {
  const lessons = yield* Effect.serviceOption(Lessons);
  return {
    [CMDECK_WS_METHODS.lessonsSetProject]: (input) =>
      Option.isSome(lessons)
        ? lessons.value.setProject(input)
        : Effect.fail(new DecisionsError({ detail: "Lessons are not available." })),
  } satisfies ForkRpcModuleHandlers<"lessons">;
});
