import { MessageId, type MessagePin, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isMessagePinned, nextJumpStep } from "./pins.logic";

const message = (id: string) => ({ id, kind: "message", message: { id } });
const work = (id: string) => ({ id, kind: "work" });
const idle = { hasMoreHistory: false, loading: false, error: null };

describe("nextJumpStep", () => {
  it("scrolls to the message's own row", () => {
    expect(
      nextJumpStep({
        messageId: "m2",
        rows: [message("m1"), work("w1"), message("m2")],
        entries: [message("m1"), work("w1"), message("m2")],
        history: idle,
        load: "none",
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
        load: "none",
      }),
    ).toEqual({ kind: "scroll", rowIndex: 1 });
  });

  it("loads earlier history once, waits for it, then gives up", () => {
    const base = { messageId: "old", rows: [message("m1")], entries: [message("m1")] };
    const more = { hasMoreHistory: true, loading: false, error: null };
    expect(nextJumpStep({ ...base, history: more, load: "none" })).toEqual({
      kind: "load-earlier",
    });
    // Asked, but the load has not started or not landed yet.
    expect(nextJumpStep({ ...base, history: more, load: "pending" })).toEqual({ kind: "wait" });
    expect(nextJumpStep({ ...base, history: { ...more, loading: true }, load: "done" })).toEqual({
      kind: "wait",
    });
    expect(nextJumpStep({ ...base, history: more, load: "done" })).toEqual({ kind: "missing" });
  });

  it("reports a message that is not in the thread", () => {
    expect(
      nextJumpStep({
        messageId: "gone",
        rows: [message("m1")],
        entries: [message("m1")],
        history: undefined,
        load: "none",
      }),
    ).toEqual({ kind: "missing" });
    expect(
      nextJumpStep({
        messageId: "gone",
        rows: [message("m1")],
        entries: [message("m1")],
        history: { hasMoreHistory: true, loading: false, error: "offline" },
        load: "none",
      }),
    ).toEqual({ kind: "missing" });
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
