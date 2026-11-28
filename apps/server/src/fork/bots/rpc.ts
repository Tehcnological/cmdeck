import { BotsError, CMDECK_WS_METHODS, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Bots, type BotActor } from "./Bots.ts";

export const handlers = Effect.gen(function* () {
  const bots = yield* Effect.serviceOption(Bots);
  const noBots = Effect.fail(new BotsError({ reason: "Bots are not available." }));
  const asPerson: BotActor = { createdBy: "user", creationSource: "web" };
  return {
    [CMDECK_WS_METHODS.botsList]: () => (Option.isSome(bots) ? bots.value.list : noBots),
    [CMDECK_WS_METHODS.botsCreate]: (input) =>
      Option.isSome(bots) ? bots.value.create(input, asPerson) : noBots,
    [CMDECK_WS_METHODS.botsUpdate]: (input) =>
      Option.isSome(bots) ? bots.value.update(input) : noBots,
    [CMDECK_WS_METHODS.botsDelete]: (input) =>
      Option.isSome(bots) ? bots.value.delete(input.id) : noBots,
    [CMDECK_WS_METHODS.botsRestore]: (input) =>
      Option.isSome(bots) ? bots.value.restore(input.id) : noBots,
    [CMDECK_WS_METHODS.botsSchedule]: (input) =>
      Option.isSome(bots) ? bots.value.schedule(input, asPerson) : noBots,
    [CMDECK_WS_METHODS.botsWake]: (input) =>
      Option.isSome(bots) ? bots.value.wake(input.id) : noBots,
  } satisfies ForkRpcModuleHandlers<"bots">;
});
