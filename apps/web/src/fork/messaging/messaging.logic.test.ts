import { MessagingError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { messagingErrorReason, splitAllowlist } from "./messaging.logic";

describe("splitAllowlist", () => {
  it("accepts commas, spaces and new lines and drops blanks", () => {
    expect(splitAllowlist(" 42, 7\n\n99 ,")).toEqual(["42", "7", "99"]);
    expect(splitAllowlist("  ")).toEqual([]);
  });
});

describe("messagingErrorReason", () => {
  it("reads a messaging refusal and ignores anything else", () => {
    expect(messagingErrorReason(new MessagingError({ reason: "empty_allowlist" }))).toBe(
      "empty_allowlist",
    );
    expect(messagingErrorReason(new Error("boom"))).toBeNull();
    expect(messagingErrorReason(null)).toBeNull();
  });
});
