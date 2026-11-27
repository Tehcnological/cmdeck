import {
  type MemoryBulkEditInput,
  type MemoryEditInput,
  type MemoryListInput,
  type MemoryRememberInput,
  type MemoryRevertInput,
  MemoryRpcError,
  type SetThreadMemoryModeInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { targetScope } from "./MemoryAccess.ts";
import * as MemoryStore from "./MemoryStore.ts";

type StoreError =
  | MemoryStore.MemoryAccessDeniedError
  | MemoryStore.MemoryItemNotFoundError
  | MemoryStore.MemorySelectionStaleError
  | MemoryStore.MemoryStoreError;

const toRpcError = (error: StoreError) => new MemoryRpcError({ reason: error.message });

const memoryOff = new MemoryRpcError({
  reason: "Memory is off. Turn it on in Settings > Memory.",
});

/**
 * The person's memory actions, for the fork RPC handlers. Each one is a MemoryStore method;
 * this only checks that memory is on and turns store errors into one wire error.
 */
export const make = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const memory = yield* Effect.serviceOption(MemoryStore.MemoryStore);

  const withStore = Effect.fn("MemoryRpc.withStore")(
    function* <A>(
      use: (
        store: MemoryStore.MemoryStore["Service"],
      ) => Effect.Effect<A, StoreError | MemoryRpcError>,
    ) {
      if (Option.isNone(memory) || !(yield* memory.value.enabled)) return yield* memoryOff;
      return yield* use(memory.value);
    },
    Effect.catchTags({
      MemoryAccessDeniedError: (error) => Effect.fail(toRpcError(error)),
      MemoryItemNotFoundError: (error) => Effect.fail(toRpcError(error)),
      MemorySelectionStaleError: (error) => Effect.fail(toRpcError(error)),
      MemoryStoreError: (error) => Effect.fail(toRpcError(error)),
    }),
  );

  return {
    list: (input: MemoryListInput) => withStore((store) => store.list(input)),
    revisions: (itemId: string) => withStore((store) => store.revisions(itemId)),
    edit: (input: MemoryEditInput) => withStore((store) => store.edit(input)),
    revert: (input: MemoryRevertInput) =>
      withStore((store) => store.revert({ ...input, actor: "user" })),
    previewEdit: (input: MemoryBulkEditInput) =>
      withStore((store) => store.bulkEdit({ ...input, apply: false })),
    applyEdit: (input: MemoryBulkEditInput) =>
      withStore((store) => store.bulkEdit({ ...input, apply: true })),
    remember: (input: MemoryRememberInput) =>
      withStore((store) =>
        Effect.gen(function* () {
          const context = yield* store.resolveThread(input.threadId);
          const target = input.scope ?? "project";
          const scope = targetScope(context, target);
          if (scope === undefined) {
            return yield* new MemoryRpcError({
              reason: `This thread has no ${target} scope. Save it to the project or everywhere.`,
            });
          }
          return yield* store.remember({
            context,
            scope,
            kind: input.kind ?? "fact",
            content: input.content,
            actor: "user",
          });
        }),
      ),
    threadMode: (threadId: ThreadId) =>
      withStore((store) => Effect.map(store.threadMode(threadId), (mode) => ({ mode }))),
    setThreadMode: (input: SetThreadMemoryModeInput) =>
      withStore((store) =>
        store.setThreadMode(input.threadId, input.mode).pipe(Effect.as({ mode: input.mode })),
      ),
    injections: (threadId: ThreadId) => withStore((store) => store.injections(threadId)),
  };
});
