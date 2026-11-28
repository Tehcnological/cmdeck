import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { ContainerSandbox } from "./ContainerSandbox.ts";

/**
 * Archiving or deleting a thread removes its containers. A killed CLI client (Windows ends it
 * without a signal) would otherwise leave one running until the next start-up reap. Subscribes
 * only once a container has started, so an unused sandbox adds no fibre.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sandbox = yield* Effect.serviceOption(ContainerSandbox);
    if (Option.isNone(sandbox)) return;
    const engine = yield* Orchestrator.OrchestratorV2;
    const scope = yield* Effect.scope;
    yield* sandbox.value.whenInUse(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "thread.archived" || event.type === "thread.deleted"
          ? sandbox.value.removeThread(event.threadId)
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Stopped removing containers of archived threads", { cause }),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      ),
    );
  }),
);
