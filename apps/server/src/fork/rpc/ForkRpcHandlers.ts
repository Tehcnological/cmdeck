import { CMDECK_RPC_VERSION, CMDECK_WS_METHODS, ForkWsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** Spread into the server's WS handlers; each fork module adds its methods here. */
export const make = Effect.succeed(
  ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
  }),
);
