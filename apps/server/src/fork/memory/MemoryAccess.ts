import type { MemoryScope, ThreadId, ThreadMemoryMode } from "@t3tools/contracts";

/** What a thread may see: its own scopes and its memory mode. */
export interface MemoryThreadContext {
  readonly threadId: ThreadId;
  readonly projectId: string | null;
  /** The repository's grouping key, shared by every worktree and clone of it. */
  readonly repoKey: string | null;
  /** Set for a bot's own thread (bot profiles register later). */
  readonly botId: string | null;
  readonly mode: ThreadMemoryMode;
}

/** A thread whose context could not be read gets no memory at all. */
export const restrictedContext = (threadId: ThreadId): MemoryThreadContext => ({
  threadId,
  projectId: null,
  repoKey: null,
  botId: null,
  mode: "temporary",
});

const scopesOf = (context: MemoryThreadContext): ReadonlyArray<MemoryScope> => [
  "global",
  `thread:${context.threadId}`,
  ...(context.projectId === null ? [] : [`project:${context.projectId}`]),
  ...(context.repoKey === null ? [] : [`repo:${context.repoKey}`]),
  ...(context.botId === null ? [] : [`bot:${context.botId}`]),
];

/**
 * The one access check every memory reader and writer goes through. Incognito reads but never
 * writes; temporary does neither; a scope outside the thread's own is never touched.
 */
export const allows = (
  context: MemoryThreadContext,
  access: "read" | "write",
  scope?: MemoryScope,
): boolean => {
  const modeAllows =
    access === "read" ? context.mode !== "temporary" : context.mode === "persistent";
  return modeAllows && (scope === undefined || scopesOf(context).includes(scope));
};

/** The scopes a thread may read, or none. Queries filter on exactly these. */
export const readableScopes = (context: MemoryThreadContext): ReadonlyArray<MemoryScope> =>
  allows(context, "read") ? scopesOf(context) : [];
