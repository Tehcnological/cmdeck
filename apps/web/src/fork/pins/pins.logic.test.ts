import { MessageId, type MessagePin, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isMessagePinned, MAX_JUMP_PAGES, nextJumpStep } from "./pins.logic";

const message = (id: string) => ({ id, kind: "message", message: { id } });
const work = (id: string) => ({ id, kind: "work" });
const idle = { hasMoreHistory: false, loading: false, error: null };

const fresh = { requestedCursors: new Set<string>(), loadSeen: false };
const asked = (cursors: ReadonlyArray<string>, loadSeen: boolean) => ({
  requestedCursors: new Set(cursors),
  loadSeen,
});
const more = { hasMoreHistory: true, loading: false, error: null };

describe("nextJumpStep", () => {
  it("scrolls to the message's own row", () => {
    expect(
      nextJumpStep({
        messageId: "m2",
        rows: [message("m1"), work("w1"), message("m2")],
        entries: [message("m1"), work("w1"), message("m2")],
        history: idle,
        paging: fresh,
      }),
    ).toEqual({ kind: "scroll", rowIndex: 2 });
  });

  it("lands on the nearest row above a message folded into its turn", () => {
    expect(
      nextJumpStep({
        messageId: "m2",
        rows: [message("m1"), work("fold"), message("m3")],
        entries: [message("m1"), work("fold"), message("m2"), message("m3")],
        history: idle,
        paging: fresh,
      }),
    ).toEqual({ kind: "scroll", rowIndex: 1 });
  });

  it("keeps paging while each page brings older entries, then scrolls once it arrives", () => {
    const first = { messageId: "old", rows: [message("m3")], entries: [message("m3")] };
    expect(nextJumpStep({ ...first, history: more, paging: fresh })).toEqual({
      kind: "load-earlier",
      cursor: "m3",
    });
    // Asked, not started yet: a request is not a finished load.
    expect(nextJumpStep({ ...first, history: more, paging: asked(["m3"], false) })).toEqual({
      kind: "wait",
    });
    expect(
      nextJumpStep({
        ...first,
        history: { ...more, loading: true },
        paging: asked(["m3"], true),
      }),
    ).toEqual({ kind: "wait" });
    // The page landed without the message but the cursor moved: ask again from there.
    const second = {
      messageId: "old",
      rows: [message("m2"), message("m3")],
      entries: [message("m2"), message("m3")],
    };
    expect(nextJumpStep({ ...second, history: more, paging: asked(["m3"], true) })).toEqual({
      kind: "load-earlier",
      cursor: "m2",
    });
    const third = {
      messageId: "old",
      rows: [message("old"), message("m2"), message("m3")],
      entries: [message("old"), message("m2"), message("m3")],
    };
    expect(nextJumpStep({ ...third, history: more, paging: asked(["m3", "m2"], true) })).toEqual({
      kind: "scroll",
      rowIndex: 0,
    });
  });

  it("stops when a finished load brought nothing older", () => {
    const base = { messageId: "old", rows: [message("m1")], entries: [message("m1")] };
    expect(nextJumpStep({ ...base, history: more, paging: asked(["m1"], true) })).toEqual({
      kind: "missing",
    });
  });

  it("stops after the page cap", () => {
    const cursors = Array.from({ length: MAX_JUMP_PAGES }, (_, n) => `c${n}`);
    expect(
      nextJumpStep({
        messageId: "old",
        rows: [message("newest")],
        entries: [message("newest")],
        history: more,
        paging: asked(cursors, true),
      }),
    ).toEqual({ kind: "too-far" });
  });

  it("reports a failed load as a load error, not a missing message", () => {
    expect(
      nextJumpStep({
        messageId: "old",
        rows: [message("m1")],
        entries: [message("m1")],
        history: { hasMoreHistory: true, loading: false, error: "offline" },
        paging: asked(["m1"], true),
      }),
    ).toEqual({ kind: "load-error", error: "offline" });
  });

  it("reports a message that is not in the thread", () => {
    for (const history of [undefined, idle]) {
      expect(
        nextJumpStep({
          messageId: "gone",
          rows: [message("m1")],
          entries: [message("m1")],
          history,
          paging: fresh,
        }),
      ).toEqual({ kind: "missing" });
    }
  });
});

describe("isMessagePinned", () => {
  const pin: MessagePin = {
    threadId: ThreadId.make("t"),
    messageId: MessageId.make("m1"),
    role: "user",
    preview: "hi",
    pinnedAt: 1,
  };

  it("matches by message id and treats unloaded pins as unpinned", () => {
    expect(isMessagePinned([pin], "m1")).toBe(true);
    expect(isMessagePinned([pin], "m2")).toBe(false);
    expect(isMessagePinned(null, "m1")).toBe(false);
  });
});
