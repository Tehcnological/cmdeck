import { CMDECK_RPC_VERSION, CMDECK_WS_METHODS, ForkWsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Modules from "./modules.ts";

type Handlers = (typeof Modules)[keyof typeof Modules]["handlers"];
type Merged<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void
  ? I
  : never;
const modules: ReadonlyArray<
  Effect.Effect<Effect.Success<Handlers>, Effect.Error<Handlers>, Effect.Services<Handlers>>
> = Object.values(Modules).map((module) => module.handlers);

/**
 * Spread into the server's WS handlers. Each fork module serves its own methods from its `rpc.ts`
 * (listed in `modules.ts`); a module's services are optional there, so upstream's ws tests, which
 * build the handlers without fork services, still compile.
 */
export const make = Effect.gen(function* () {
  const handlers = yield* Effect.all(modules);
  return ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
    ...(Object.assign({}, ...handlers) as Merged<Effect.Success<Handlers>>),
  });
});
