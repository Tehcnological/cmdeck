import { CMDECK_WS_METHODS, type ForkRpcModuleHandlers } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MemoryEmbeddings } from "./MemoryEmbeddings.ts";
import * as MemoryRpc from "./MemoryRpc.ts";

export const handlers = Effect.gen(function* () {
  const memory = yield* MemoryRpc.make;
  const embeddings = yield* Effect.serviceOption(MemoryEmbeddings);
  return {
    [CMDECK_WS_METHODS.memoryList]: memory.list,
    [CMDECK_WS_METHODS.memoryRevisions]: (input) => memory.revisions(input.itemId),
    [CMDECK_WS_METHODS.memoryEdit]: memory.edit,
    [CMDECK_WS_METHODS.memoryRevert]: memory.revert,
    [CMDECK_WS_METHODS.memoryPreviewEdit]: memory.previewEdit,
    [CMDECK_WS_METHODS.memoryApplyEdit]: memory.applyEdit,
    [CMDECK_WS_METHODS.memoryRemember]: memory.remember,
    [CMDECK_WS_METHODS.memoryThreadMode]: (input) => memory.threadMode(input.threadId),
    [CMDECK_WS_METHODS.memorySetThreadMode]: memory.setThreadMode,
    [CMDECK_WS_METHODS.memoryInjections]: (input) => memory.injections(input.threadId),
    [CMDECK_WS_METHODS.memoryEmbeddingsStatus]: () =>
      Option.isSome(embeddings)
        ? embeddings.value.status
        : Effect.succeed({
            mode: "keyword" as const,
            embedder: null,
            embedded: 0,
            total: 0,
            checkedAt: null,
          }),
  } satisfies ForkRpcModuleHandlers<"memory">;
});
