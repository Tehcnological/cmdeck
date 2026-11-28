import { setPairingServerKeyOnUrl, setPairingTokenOnUrl } from "@t3tools/shared/remote";

export function resolveDesktopPairingUrl(
  endpointUrl: string,
  credential: string,
  serverIdentityKey?: string | null,
): string {
  const url = new URL(endpointUrl);
  url.pathname = "/pair";
  const withToken = setPairingTokenOnUrl(url, credential);
  // Older clients ignore the unknown hash param; newer ones pin the server's
  // E2EE identity key from it.
  return serverIdentityKey
    ? setPairingServerKeyOnUrl(withToken, serverIdentityKey).toString()
    : withToken.toString();
}
