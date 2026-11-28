import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers, KnowledgeError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Knowledge } from "./Knowledge.ts";

export const handlers = Effect.gen(function* () {
  const knowledge = yield* Effect.serviceOption(Knowledge);
  const unavailable = Effect.fail(
    new KnowledgeError({ message: "The knowledge library is not available on this server." }),
  );
  return {
    [CMDECK_WS_METHODS.knowledgeList]: (input) =>
      Option.isSome(knowledge) ? knowledge.value.list(input.projectId) : unavailable,
    [CMDECK_WS_METHODS.knowledgeAddSource]: (input) =>
      Option.isSome(knowledge) ? knowledge.value.addSource(input) : unavailable,
    [CMDECK_WS_METHODS.knowledgeRemoveSource]: (input) =>
      Option.isSome(knowledge) ? knowledge.value.removeSource(input.sourceId) : unavailable,
    [CMDECK_WS_METHODS.knowledgeReindex]: (input) =>
      Option.isSome(knowledge) ? knowledge.value.reindex(input.sourceId) : unavailable,
    [CMDECK_WS_METHODS.knowledgeCancel]: (input) =>
      Option.isSome(knowledge) ? knowledge.value.cancel(input.sourceId) : unavailable,
  } satisfies ForkRpcModuleHandlers<"knowledge">;
});
