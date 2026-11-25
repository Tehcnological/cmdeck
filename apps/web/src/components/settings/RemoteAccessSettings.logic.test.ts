import { describe, expect, it } from "vite-plus/test";

import { endpointDefaultPreferenceKey, selectPairingEndpoint } from "./ConnectionsSettings.logic";
import { resolveDesktopPairingUrl } from "./pairingUrls";
import {
  externalBaseUrl,
  publicAddressCheckLabel,
  publicBaseUrlProblemLabel,
  remoteMcpEndpointUrl,
  remoteMcpSwitchState,
  tunnelPairingEndpoint,
} from "./RemoteAccessSettings.logic";

describe("tunnelPairingEndpoint", () => {
  it("makes the tunnel the default pairing address while it is set", () => {
    const tunnel = tunnelPairingEndpoint("https://cmdeck.example.com/");
    expect(tunnel?.httpBaseUrl).toBe("https://cmdeck.example.com");
    expect(tunnel?.wsBaseUrl).toBe("wss://cmdeck.example.com");
    expect(selectPairingEndpoint(tunnel ? [tunnel] : [], null)).toBe(tunnel);
    expect(resolveDesktopPairingUrl(tunnel!.httpBaseUrl, "secret")).toMatch(
      /^https:\/\/cmdeck\.example\.com\/pair/u,
    );
    expect(endpointDefaultPreferenceKey(tunnel!)).toContain("cloudflare-tunnel");
  });

  it("is absent while unset or invalid", () => {
    expect(tunnelPairingEndpoint("")).toBeNull();
    expect(tunnelPairingEndpoint("http://cmdeck.example.com")).toBeNull();
  });
});

describe("remote MCP address", () => {
  it("prefers the tunnel over the address this client uses", () => {
    expect(externalBaseUrl("https://cmdeck.example.com", "http://127.0.0.1:3773")).toBe(
      "https://cmdeck.example.com",
    );
    expect(externalBaseUrl("", "http://100.64.0.1:3773/")).toBe("http://100.64.0.1:3773");
    expect(externalBaseUrl("", null)).toBeNull();
    expect(remoteMcpEndpointUrl("https://cmdeck.example.com")).toBe(
      "https://cmdeck.example.com/mcp",
    );
    expect(remoteMcpEndpointUrl(null)).toBeNull();
  });

  it("locks the switch to T3CODE_REMOTE_MCP when the server started with it", () => {
    expect(remoteMcpSwitchState(null, true)).toEqual({ enabled: true, lockedByEnv: false });
    expect(remoteMcpSwitchState(false, true)).toEqual({ enabled: false, lockedByEnv: true });
    expect(remoteMcpSwitchState(true, false)).toEqual({ enabled: true, lockedByEnv: true });
  });
});

describe("tunnel address copy", () => {
  it("explains what is wrong with an address", () => {
    expect(publicBaseUrlProblemLabel("https://cmdeck.example.com")).toBeNull();
    expect(publicBaseUrlProblemLabel("http://cmdeck.example.com")).toBe("Use an https:// address.");
    expect(publicBaseUrlProblemLabel("https://cmdeck.example.com/app")).toBe(
      "Use only the address, without a path.",
    );
  });

  it("says plainly what the check found", () => {
    expect(publicAddressCheckLabel({ status: "reachable" }).tone).toBe("success");
    expect(publicAddressCheckLabel({ status: "access-login", httpStatus: 302 }).text).toContain(
      "Cloudflare Access",
    );
    expect(publicAddressCheckLabel({ status: "unreachable", httpStatus: 530 }).text).toBe(
      "Not reachable. The address answered with HTTP 530.",
    );
  });
});
