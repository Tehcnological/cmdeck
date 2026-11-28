import {
  CMDECK_WS_METHODS,
  type ForkRpcModuleHandlers,
  SessionStateError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SessionState } from "./SessionState.ts";

export const handlers = Effect.gen(function* () {
  const state = yield* Effect.serviceOption(SessionState);
  const none = Effect.fail(new SessionStateError({ reason: "unavailable" }));
  return {
    [CMDECK_WS_METHODS.sessionStateGet]: (input) =>
      Option.isSome(state) ? state.value.get(input.threadId) : none,
    [CMDECK_WS_METHODS.sessionStateClear]: (input) =>
      Option.isSome(state) ? state.value.clear(input.threadId) : none,
  } satisfies ForkRpcModuleHandlers<"sessionState">;
});
