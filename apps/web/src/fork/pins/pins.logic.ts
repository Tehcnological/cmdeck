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

/** Whether this jump asked for older history, and whether that load has changed the entries yet. */
export type JumpLoad = "none" | "pending" | "done";

export type JumpStep =
  | { readonly kind: "scroll"; readonly rowIndex: number }
  | { readonly kind: "load-earlier" }
  | { readonly kind: "wait" }
  | { readonly kind: "missing" };

/**
 * What jumping to a pinned message does with the timeline as it is now. A message folded into
 * its turn has no row, so the jump lands on the nearest row above it. A message older than the
 * loaded history loads through it once; if it is still absent, it is gone from the thread.
 */
export function nextJumpStep(input: {
  readonly messageId: string;
  readonly rows: ReadonlyArray<JumpRow>;
  readonly entries: ReadonlyArray<JumpEntry>;
  readonly history: JumpHistory | undefined;
  readonly load: JumpLoad;
}): JumpStep {
  const { messageId, rows, entries, history } = input;
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
  if (history === undefined || history.error !== null) return { kind: "missing" };
  if (history.loading || input.load === "pending") return { kind: "wait" };
  if (history.hasMoreHistory && input.load === "none") return { kind: "load-earlier" };
  return { kind: "missing" };
}
