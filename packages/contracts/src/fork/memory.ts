import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { InferenceServerId } from "../inference.ts";

/**
 * Who may read an item: everyone (`global`), one project, every project on one repository
 * (`repo:<grouping key>`, so it follows the project across worktrees and clones), one bot's thread,
 * or one thread.
 */
export const MemoryScope = Schema.String.check(
  Schema.isPattern(/^(?:global|(?:project|repo|bot|thread):\S.*)$/u),
);
export type MemoryScope = typeof MemoryScope.Type;

/** A rule is injected on every turn it is visible to; a fact only when it matches the turn. */
export const MemoryKind = Schema.Literals(["rule", "fact"]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryStatus = Schema.Literals(["active", "pending", "retired"]);
export type MemoryStatus = typeof MemoryStatus.Type;

/** Only the first two can become standing rules; the others arrive pending until a person accepts. */
export const MemoryProvenance = Schema.Literals([
  "user_explicit",
  "user_confirmed",
  "agent_inferred",
  "imported",
]);
export type MemoryProvenance = typeof MemoryProvenance.Type;

/** Incognito reads but never writes; temporary does neither. Threads without a mode are persistent. */
const THREAD_MEMORY_MODES = ["persistent", "incognito", "temporary"] as const;
export const ThreadMemoryMode = Schema.Literals(THREAD_MEMORY_MODES);
export type ThreadMemoryMode = typeof ThreadMemoryMode.Type;

// Ported from KiroCrew@b75544f0 src/kiro_crew/execution_context.py `stricter_memory_mode` (Apache-2.0).
/** The most private of the modes, in the order persistent < incognito < temporary. */
export const stricterMemoryMode = (
  first: ThreadMemoryMode,
  ...rest: ReadonlyArray<ThreadMemoryMode>
): ThreadMemoryMode =>
  rest.reduce(
    (strictest, mode) =>
      THREAD_MEMORY_MODES.indexOf(mode) > THREAD_MEMORY_MODES.indexOf(strictest) ? mode : strictest,
    first,
  );

export const MemoryItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: MemoryScope,
  kind: MemoryKind,
  content: TrimmedNonEmptyString,
  provenance: MemoryProvenance,
  status: MemoryStatus,
  originThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MemoryItem = typeof MemoryItem.Type;

export const MemoryRevision = Schema.Struct({
  itemId: TrimmedNonEmptyString,
  revision: PositiveInt,
  actor: Schema.Literals(["user", "agent"]),
  before: Schema.NullOr(MemoryItem),
  after: MemoryItem,
  createdAt: IsoDateTime,
});
export type MemoryRevision = typeof MemoryRevision.Type;

/** The part of a scope before the colon, which Settings filters on. */
export const MemoryScopeKind = Schema.Literals(["global", "project", "repo", "bot", "thread"]);
export type MemoryScopeKind = typeof MemoryScopeKind.Type;

/** Where `/remember` saves, relative to the thread it is typed in. */
export const MemoryTargetScope = Schema.Literals(["project", "repo", "thread", "global"]);
export type MemoryTargetScope = typeof MemoryTargetScope.Type;

export const MemoryListInput = Schema.Struct({
  scopeKind: Schema.optionalKey(MemoryScopeKind),
  status: Schema.optionalKey(MemoryStatus),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryItemIdInput = Schema.Struct({ itemId: TrimmedNonEmptyString });
export type MemoryItemIdInput = typeof MemoryItemIdInput.Type;

/**
 * A person's edit of one item's content or kind. Scope and provenance are protected: they say
 * who may read the item and where it came from, so the content editor never changes them.
 */
export const MemoryEditInput = Schema.Struct({
  itemId: TrimmedNonEmptyString,
  content: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  kind: Schema.optionalKey(MemoryKind),
});
export type MemoryEditInput = typeof MemoryEditInput.Type;

export const MemoryRevertInput = Schema.Struct({
  itemId: TrimmedNonEmptyString,
  revision: PositiveInt,
});
export type MemoryRevertInput = typeof MemoryRevertInput.Type;

/** The most items one bulk edit may select, as in Kiro. */
const MEMORY_BULK_EDIT_MAX_ITEMS = 500;

/** What a bulk edit does to each selected item. Each one can be undone. */
export const MemoryBulkOperation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("accept") }),
  Schema.Struct({ type: Schema.Literal("retire") }),
  Schema.Struct({ type: Schema.Literal("restore") }),
  Schema.Struct({
    type: Schema.Literal("replace_text"),
    find: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
    replacement: Schema.String.check(Schema.isMaxLength(2_000)),
    matchCase: Schema.Boolean,
  }),
]);
export type MemoryBulkOperation = typeof MemoryBulkOperation.Type;

// Ported from KiroCrew@b75544f0 src/kiro_crew/memory_edit.py `_selection` (Apache-2.0): the
// selection names each item as it was shown, so an item changed since is refused, not edited.
export const MemoryBulkEditInput = Schema.Struct({
  items: Schema.Array(MemoryItem).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MEMORY_BULK_EDIT_MAX_ITEMS),
  ),
  operation: MemoryBulkOperation,
});
export type MemoryBulkEditInput = typeof MemoryBulkEditInput.Type;

/** One item a bulk edit changes, as it is and as it would be. */
export const MemoryBulkEditChange = Schema.Struct({ before: MemoryItem, after: MemoryItem });
export type MemoryBulkEditChange = typeof MemoryBulkEditChange.Type;

/** A preview writes nothing; applying the same input writes exactly these changes. */
export const MemoryBulkEditResult = Schema.Struct({
  matchedCount: Schema.Number,
  changes: Schema.Array(MemoryBulkEditChange),
});
export type MemoryBulkEditResult = typeof MemoryBulkEditResult.Type;

export const ThreadMemoryModeInput = Schema.Struct({ threadId: ThreadId });
export type ThreadMemoryModeInput = typeof ThreadMemoryModeInput.Type;

export const SetThreadMemoryModeInput = Schema.Struct({
  threadId: ThreadId,
  mode: ThreadMemoryMode,
});
export type SetThreadMemoryModeInput = typeof SetThreadMemoryModeInput.Type;

/** `/remember` in a thread: saved as the person's own and used at once, unless the mode refuses. */
export const MemoryRememberInput = Schema.Struct({
  threadId: ThreadId,
  content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  kind: Schema.optionalKey(MemoryKind),
  scope: Schema.optionalKey(MemoryTargetScope),
});
export type MemoryRememberInput = typeof MemoryRememberInput.Type;

/** One item a turn of the thread was given, as the item is now. */
export const MemoryInjection = Schema.Struct({
  runId: TrimmedNonEmptyString,
  injectedAt: IsoDateTime,
  item: MemoryItem,
});
export type MemoryInjection = typeof MemoryInjection.Type;

export class MemoryRpcError extends Schema.TaggedError<MemoryRpcError>()("MemoryRpcError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

/** The registered inference server and model memory search embeds with (`cmdeck.memoryEmbedder`). */
export const MemoryEmbedderSetting = Schema.Struct({
  serverId: InferenceServerId,
  model: TrimmedNonEmptyString,
});
export type MemoryEmbedderSetting = typeof MemoryEmbedderSetting.Type;

/**
 * How memory search ranks right now. `keyword`: no embedder is set, so full-text search only.
 * `hybrid`: meaning and keywords. `unavailable`: the embedder failed, so keyword search stands in.
 */
export const MemorySearchMode = Schema.Literals(["keyword", "hybrid", "unavailable"]);
export type MemorySearchMode = typeof MemorySearchMode.Type;

export const MemoryEmbeddingsStatus = Schema.Struct({
  mode: MemorySearchMode,
  embedder: Schema.NullOr(MemoryEmbedderSetting),
  /** Active items embedded with the current embedder, out of all active items. */
  embedded: NonNegativeInt,
  total: NonNegativeInt,
  /** Why the embedder is unavailable, when it is. */
  message: Schema.optional(TrimmedNonEmptyString),
  checkedAt: Schema.NullOr(IsoDateTime),
});
export type MemoryEmbeddingsStatus = typeof MemoryEmbeddingsStatus.Type;
