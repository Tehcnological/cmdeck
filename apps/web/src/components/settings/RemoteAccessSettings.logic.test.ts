import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  endpointDefaultPreferenceKey,
  selectPairingEndpoint,
  selectQrEndpointOption,
} from "./ConnectionsSettings.logic";
import { resolveDesktopPairingUrl } from "./pairingUrls";
import {
  externalBaseUrl,
  publicAddressCheckLabel,
  publicBaseUrlProblemLabel,
  remoteMcpAddresses,
  remoteMcpEndpointUrl,
  remoteMcpSwitchState,
  tunnelPairingEndpoint,
} from "./RemoteAccessSettings.logic";

describe("tunnelPairingEndpoint", () => {
  it("offers the tunnel with its host but uses it only when picked", () => {
    const tunnel = tunnelPairingEndpoint("https://cmdeck.example.com/")!;
    expect(tunnel.label).toBe("Cloudflare Tunnel (cmdeck.example.com)");
    expect(tunnel.httpBaseUrl).toBe("https://cmdeck.example.com");
    expect(tunnel.wsBaseUrl).toBe("wss://cmdeck.example.com");
    expect(tunnel.isDefault).toBe(false);
    expect(resolveDesktopPairingUrl(tunnel.httpBaseUrl, "secret")).toMatch(
      /^https:\/\/cmdeck\.example\.com\/pair/u,
    );
    const tunnelKey = endpointDefaultPreferenceKey(tunnel);
    expect(tunnelKey).toContain("cloudflare-tunnel");

    expect(selectPairingEndpoint([tunnel], null)).toBeNull();
    const lan = {
      ...tunnel,
      id: "desktop-lan:http://192.168.1.5:3783",
      reachability: "lan" as const,
    };
    expect(selectPairingEndpoint([lan, tunnel], null)).toBe(lan);
    expect(selectPairingEndpoint([lan, tunnel], tunnelKey)).toBe(tunnel);

    const option = { id: tunnel.id, preferenceKey: tunnelKey, qrShareable: true };
    expect(selectQrEndpointOption([option], null, null)).toBeNull();
    expect(selectQrEndpointOption([option], tunnel.id, null)).toBe(option);
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

  const endpoint = (
    id: string,
    httpBaseUrl: string,
    reachability: AdvertisedEndpoint["reachability"],
    status: AdvertisedEndpoint["status"] = "available",
  ): AdvertisedEndpoint => ({
    ...tunnelPairingEndpoint("https://x.example.com")!,
    id,
    httpBaseUrl,
    reachability,
    status,
  });
  const loopback = endpoint("desktop-loopback:3783", "http://127.0.0.1:3783", "loopback");
  const lan = endpoint("desktop-lan:http://192.168.4.176:3783", "http://192.168.4.176:3783", "lan");
  const tailscaleIp = endpoint(
    "tailscale-ip:http://100.64.0.1:3783",
    "http://100.64.0.1:3783",
    "private-network",
  );
  const serve = (status: AdvertisedEndpoint["status"]) =>
    endpoint(
      "tailscale-magicdns:https://desk.tail1.ts.net",
      "https://desk.tail1.ts.net/",
      "private-network",
      status,
    );

  it("lists the tunnel, then Tailscale Serve, then the local network, each once", () => {
    const addresses = remoteMcpAddresses(
      "https://cmdeck.example.com",
      [loopback, lan, tailscaleIp, serve("available"), lan],
      "http://192.168.4.176:3783",
    );
    expect(addresses).toEqual([
      {
        url: "https://cmdeck.example.com/mcp",
        label: "Cloudflare Tunnel",
        localNetworkOnly: false,
      },
      { url: "https://desk.tail1.ts.net/mcp", label: "Tailscale", localNetworkOnly: false },
      { url: "http://192.168.4.176:3783/mcp", label: "Local network only", localNetworkOnly: true },
    ]);
  });

  it("uses the tailnet IP while Tailscale Serve does not answer", () => {
    expect(
      remoteMcpAddresses("", [serve("unavailable"), tailscaleIp], null).map((a) => a.url),
    ).toEqual(["http://100.64.0.1:3783/mcp"]);
  });

  it("falls back to the address this client uses when nothing is advertised", () => {
    expect(remoteMcpAddresses("", [loopback], "http://192.168.4.176:3783")).toEqual([
      { url: "http://192.168.4.176:3783/mcp", label: null, localNetworkOnly: false },
    ]);
    expect(remoteMcpAddresses("http://not-https.example.com", [], null)).toEqual([]);
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
