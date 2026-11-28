import {
  CMDECK_WS_METHODS,
  type ForkRpcModuleHandlers,
  MessagePinsError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MessagePins } from "./MessagePins.ts";

export const handlers = Effect.gen(function* () {
  const pins = yield* Effect.serviceOption(MessagePins);
  const noPins = Effect.fail(new MessagePinsError({ reason: "unavailable" }));
  return {
    [CMDECK_WS_METHODS.messagePinsList]: (input) =>
      Option.isSome(pins) ? pins.value.list(input.threadId) : noPins,
    [CMDECK_WS_METHODS.messagePinsPin]: (input) =>
      Option.isSome(pins) ? pins.value.pin(input) : noPins,
    [CMDECK_WS_METHODS.messagePinsUnpin]: (input) =>
      Option.isSome(pins) ? pins.value.unpin(input) : noPins,
  } satisfies ForkRpcModuleHandlers<"messagePins">;
});
