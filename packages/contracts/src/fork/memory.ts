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
export const ThreadMemoryMode = Schema.Literals(["persistent", "incognito", "temporary"]);
export type ThreadMemoryMode = typeof ThreadMemoryMode.Type;

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
