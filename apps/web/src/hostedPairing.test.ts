import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  hasHostedPairingRequest,
  readHostedPairingRequest,
  shareableAppOrigin,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads hosted pairing host and query token parameters", () => {
    const url = new URL("https://web.example.com/pair?host=100.64.1.2:3773&token=ABCD1234");

    expect(readHostedPairingRequest(url)).toEqual({
      host: "100.64.1.2:3773",
      token: "ABCD1234",
      label: "",
    });
    expect(hasHostedPairingRequest(url)).toBe(true);
  });

  it("shares this page's own web origin, and none from the packaged desktop window", () => {
    vi.stubGlobal("window", { location: new URL("https://box.tail1234.ts.net/settings") });
    expect(shareableAppOrigin()).toBe("https://box.tail1234.ts.net");

    vi.stubGlobal("window", { location: new URL("t3code://app/index.html") });
    expect(shareableAppOrigin()).toBeUndefined();
  });
});
