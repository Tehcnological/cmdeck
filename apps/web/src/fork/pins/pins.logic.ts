import type { MessagePin } from "@t3tools/contracts";

export const isMessagePinned = (
  pins: ReadonlyArray<MessagePin> | null,
  messageId: string,
): boolean => pins?.some((pin) => pin.messageId === messageId) ?? false;

interface JumpRow {
  readonly id: string;
  readonly kind: string;
  readonly message?: { readonly id: string };
}

interface JumpEntry {
  readonly id: string;
  readonly kind: string;
  readonly message?: { readonly id: string };
}

export interface JumpHistory {
  readonly hasMoreHistory: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

/** Pages one jump may load before it stops; a pin far back is reached by scrolling instead. */
export const MAX_JUMP_PAGES = 20;

/**
 * One jump's paging so far: the oldest loaded entry each page was asked from, and whether the
 * latest request was seen loading (a request that has not started yet is not a finished one).
 */
export interface JumpPaging {
  readonly requestedCursors: ReadonlySet<string>;
  readonly loadSeen: boolean;
}

export type JumpStep =
  | { readonly kind: "scroll"; readonly rowIndex: number }
  | { readonly kind: "load-earlier"; readonly cursor: string }
  | { readonly kind: "wait" }
  | { readonly kind: "missing" }
  | { readonly kind: "load-error"; readonly error: string }
  | { readonly kind: "too-far" };

/**
 * What jumping to a pinned message does with the timeline as it is now. A message folded into
 * its turn has no row, so the jump lands on the nearest row above it. An older message pages
 * history in, one page per new oldest entry, until it appears, history runs out, a page brings
 * nothing new, or `MAX_JUMP_PAGES` pages were loaded.
 */
export function nextJumpStep(input: {
  readonly messageId: string;
  readonly rows: ReadonlyArray<JumpRow>;
  readonly entries: ReadonlyArray<JumpEntry>;
  readonly history: JumpHistory | undefined;
  readonly paging: JumpPaging;
}): JumpStep {
  const { messageId, rows, entries, history, paging } = input;
  const direct = rows.findIndex((row) => row.kind === "message" && row.message?.id === messageId);
  if (direct !== -1) return { kind: "scroll", rowIndex: direct };
  const entryIndex = entries.findIndex(
    (entry) => entry.kind === "message" && entry.message?.id === messageId,
  );
  if (entryIndex !== -1) {
    const rowIndexById = new Map(rows.map((row, index) => [row.id, index]));
    for (let index = entryIndex; index >= 0; index -= 1) {
      const rowIndex = rowIndexById.get(entries[index]!.id);
      if (rowIndex !== undefined) return { kind: "scroll", rowIndex };
    }
    return rows.length > 0 ? { kind: "scroll", rowIndex: 0 } : { kind: "missing" };
  }
  if (history === undefined) return { kind: "missing" };
  if (history.error !== null) return { kind: "load-error", error: history.error };
  if (history.loading) return { kind: "wait" };
  if (!history.hasMoreHistory) return { kind: "missing" };
  const cursor = entries[0]?.id ?? "first";
  if (paging.requestedCursors.has(cursor)) {
    // Asked from this cursor: still starting, or it finished without bringing anything older.
    return paging.loadSeen ? { kind: "missing" } : { kind: "wait" };
  }
  if (paging.requestedCursors.size >= MAX_JUMP_PAGES) return { kind: "too-far" };
  return { kind: "load-earlier", cursor };
}
