import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers, MessagingError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MessagingService } from "./MessagingService.ts";

export const handlers = Effect.gen(function* () {
  const messaging = yield* Effect.serviceOption(MessagingService);
  const unavailable = Effect.fail(new MessagingError({ reason: "unavailable" }));
  return {
    [CMDECK_WS_METHODS.messagingConnect]: (input) =>
      Option.isSome(messaging)
        ? messaging.value.connect(input).pipe(Effect.map((channelId) => ({ channelId })))
        : unavailable,
    [CMDECK_WS_METHODS.messagingChatsList]: () =>
      Option.isSome(messaging) ? messaging.value.listChats : unavailable,
    [CMDECK_WS_METHODS.messagingChatsUnbind]: (input) =>
      Option.isSome(messaging) ? messaging.value.unbind(input) : unavailable,
  } satisfies ForkRpcModuleHandlers<"messaging">;
});
