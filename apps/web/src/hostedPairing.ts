import { getPairingTokenFromUrl } from "@t3tools/shared/remote";

export interface HostedPairingRequest {
  readonly host: string;
  readonly token: string;
  readonly label: string;
}

/**
 * This page's own web origin, for links other devices open. The packaged desktop window loads
 * from `t3code://app`, which nothing else can open, so it has none.
 */
export function shareableAppOrigin(): string | undefined {
  if (typeof window === "undefined" || window.location === undefined) return undefined;
  const { protocol, origin } = window.location;
  return protocol === "http:" || protocol === "https:" ? origin : undefined;
}

export function readHostedPairingRequest(url: URL = new URL(window.location.href)) {
  const host = url.searchParams.get("host")?.trim() ?? "";
  const token = getPairingTokenFromUrl(url)?.trim() ?? "";
  const label = url.searchParams.get("label")?.trim() ?? "";

  if (!host || !token) {
    return null;
  }

  return {
    host,
    token,
    label,
  } satisfies HostedPairingRequest;
}

export function hasHostedPairingRequest(url: URL = new URL(window.location.href)): boolean {
  return readHostedPairingRequest(url) !== null;
}
