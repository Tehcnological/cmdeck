// LAN fallback: a self-signed LAN certificate is trusted only by the pin its server advertised over
// the paired route, read from the saved catalog. Chromium verifies per host, not per port, so a
// pinned address accepts only its pins on every port and refuses any other certificate, publicly
// trusted ones too. Preview browsers use their own sessions.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- hashes the PEM Electron hands the verify proc.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Electron from "electron";

export type LanPins = ReadonlyMap<string, ReadonlySet<string>>;

const PIN = /^[0-9a-f]{64}$/;
const hostKey = (hostname: string) => hostname.toLowerCase().replace(/^\[|\]$/g, "");

/** Pins of the saved HTTPS routes that carry `certificateSha256`, by host. */
export function pinsFromCatalog(catalog: string | null): LanPins {
  const pins = new Map<string, Set<string>>();
  let profiles: unknown;
  try {
    profiles = catalog === null ? [] : (JSON.parse(catalog) as { profiles?: unknown }).profiles;
  } catch {
    return pins;
  }
  if (!Array.isArray(profiles)) return pins;
  for (const profile of profiles as ReadonlyArray<Record<string, unknown> | null>) {
    const pin = profile?.certificateSha256;
    if (
      profile?._tag !== "BearerConnectionProfile" ||
      typeof profile.httpBaseUrl !== "string" ||
      typeof pin !== "string" ||
      !PIN.test(pin) ||
      !URL.canParse(profile.httpBaseUrl)
    ) {
      continue;
    }
    const url = new URL(profile.httpBaseUrl);
    if (url.protocol !== "https:") continue;
    const host = hostKey(url.hostname);
    pins.set(host, new Set([...(pins.get(host) ?? []), pin]));
  }
  return pins;
}

/** Lowercase hex SHA-256 of a PEM certificate's DER bytes, as the server computes its pin. */
export const pemSha256 = (pem: string): string =>
  NodeCrypto.createHash("sha256")
    .update(Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64"))
    .digest("hex");

/** Electron verify-proc result: 0 trusts, -2 refuses, -3 keeps Chromium's own verdict. */
export function verifyPinnedCertificate(
  pins: LanPins,
  hostname: string,
  certificatePem: string,
): 0 | -2 | -3 {
  const allowed = pins.get(hostKey(hostname));
  if (allowed === undefined) return -3;
  return allowed.has(pemSha256(certificatePem)) ? 0 : -2;
}

let installed = false;

/** Hook from the connection catalog IPC: applies the catalog's pins to the app window's session. */
export const syncLanPins = (catalog: string | null) =>
  Effect.sync(() => {
    const session = Electron.session?.defaultSession;
    if (session === undefined) return;
    const pins = pinsFromCatalog(catalog);
    if (pins.size === 0) {
      // Without pins every certificate keeps Chromium's verdict, as before this feature.
      if (installed) session.setCertificateVerifyProc(null);
      installed = false;
      return;
    }
    session.setCertificateVerifyProc((request, callback) =>
      callback(verifyPinnedCertificate(pins, request.hostname, request.certificate.data)),
    );
    installed = true;
  });
