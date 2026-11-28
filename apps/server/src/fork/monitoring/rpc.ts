import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers, HeartbeatError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Heartbeat } from "./Heartbeat.ts";

export const handlers = Effect.gen(function* () {
  const heartbeat = yield* Effect.serviceOption(Heartbeat);
  return {
    [CMDECK_WS_METHODS.heartbeatStatus]: () =>
      Option.isSome(heartbeat)
        ? heartbeat.value.status
        : Effect.fail(new HeartbeatError({ reason: "The heartbeat is not available here." })),
  } satisfies ForkRpcModuleHandlers<"monitoring">;
});
