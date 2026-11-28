import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopPairingUrl } from "./pairingUrls";

describe("settings pairing URL helpers", () => {
  it("pairs on the endpoint's own /pair route, HTTP or HTTPS", () => {
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
    expect(resolveDesktopPairingUrl("https://host.tailnet.example.ts.net", "PAIRCODE")).toBe(
      "https://host.tailnet.example.ts.net/pair#token=PAIRCODE",
    );
  });
});
