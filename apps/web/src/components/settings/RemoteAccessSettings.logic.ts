import {
  type AdvertisedEndpoint,
  type PublicAddressCheckResult,
  publicBaseOrigin,
  publicBaseUrlProblem,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

export const CLOUDFLARE_TUNNEL_GUIDE_URL =
  "https://github.com/Tehcnological/cmdeck/blob/main/docs/user/cloudflare-tunnel.md";
export const REMOTE_MCP_GUIDE_URL =
  "https://github.com/Tehcnological/cmdeck/blob/main/docs/user/remote-mcp.md";

const CLOUDFLARE_TUNNEL_LABEL = "Cloudflare Tunnel";

/** The tunnel as a pairing endpoint, the default while it is set, so pairing links use it. */
export function tunnelPairingEndpoint(publicBaseUrl: string): AdvertisedEndpoint | null {
  if (publicBaseUrlProblem(publicBaseUrl) !== null) return null;
  const origin = publicBaseOrigin(publicBaseUrl);
  if (origin === null) return null;
  return {
    id: `cloudflare-tunnel:${origin}`,
    label: CLOUDFLARE_TUNNEL_LABEL,
    provider: {
      id: "cloudflare-tunnel",
      label: CLOUDFLARE_TUNNEL_LABEL,
      kind: "tunnel",
      isAddon: false,
    },
    httpBaseUrl: origin,
    wsBaseUrl: origin.replace(/^https:/u, "wss:"),
    reachability: "public",
    compatibility: { hostedHttpsApp: "unknown", desktopApp: "compatible" },
    source: "user",
    status: "available",
    isDefault: true,
  };
}

/** The tunnel's address when set, else the address this client reaches the environment at. */
export function externalBaseUrl(publicBaseUrl: string, httpBaseUrl: string | null): string | null {
  if (publicBaseUrlProblem(publicBaseUrl) === null && publicBaseUrl !== "") {
    return publicBaseOrigin(publicBaseUrl);
  }
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl).origin;
  } catch {
    return null;
  }
}

export function remoteMcpEndpointUrl(baseUrl: string | null): string | null {
  return baseUrl === null ? null : `${baseUrl}/mcp`;
}

export function publicBaseUrlProblemLabel(
  value: string,
  resolve: MessageResolver = m,
): string | null {
  switch (publicBaseUrlProblem(value)) {
    case null:
      return null;
    case "spaces":
      return resolve(msg("Remove the spaces around the address."));
    case "not-https":
      return resolve(msg("Use an https:// address."));
    case "credentials":
      return resolve(msg("Leave the user name and password out."));
    case "path":
      return resolve(msg("Use only the address, without a path."));
    case "invalid":
      return resolve(msg("Enter an address such as https://cmdeck.example.com."));
  }
}

export function publicAddressCheckLabel(
  result: PublicAddressCheckResult,
  resolve: MessageResolver = m,
): { readonly text: string; readonly tone: "success" | "warning" | "error" } {
  switch (result.status) {
    case "reachable":
      return { text: resolve(msg("Reachable. This environment answered.")), tone: "success" };
    case "access-login":
      return {
        text: resolve(
          msg(
            "Reachable behind a login (Cloudflare Access). Browsers sign in first; MCP clients need an Access service token.",
          ),
        ),
        tone: "warning",
      };
    case "other-environment":
      return {
        text: resolve(msg("A different CMDeck environment answered at this address.")),
        tone: "error",
      };
    case "unreachable":
      return {
        text:
          result.httpStatus === undefined
            ? resolve(
                msg("Not reachable. Check that cloudflared is running and routes to this machine."),
              )
            : resolve(
                msg("Not reachable. The address answered with HTTP {status}.", {
                  status: result.httpStatus,
                }),
              ),
        tone: "error",
      };
  }
}

/**
 * Which way the switch shows. `T3CODE_REMOTE_MCP` wins over the setting, so the switch is locked
 * while the server started with it.
 */
export function remoteMcpSwitchState(
  envOverride: boolean | null | undefined,
  setting: boolean,
): { readonly enabled: boolean; readonly lockedByEnv: boolean } {
  return envOverride === null || envOverride === undefined
    ? { enabled: setting, lockedByEnv: false }
    : { enabled: envOverride, lockedByEnv: true };
}
