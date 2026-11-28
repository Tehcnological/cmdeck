// @effect-diagnostics nodeBuiltinImport:off -- X.509 needs node:crypto.
// @effect-diagnostics globalDate:off -- certificate validity fields are plain dates.
import * as NodeCrypto from "node:crypto";

export interface LanCertificate {
  readonly keyPem: string;
  readonly certPem: string;
}

const tlv = (tag: number, ...content: ReadonlyArray<Buffer>): Buffer => {
  const body = Buffer.concat(content);
  const length = body.length;
  const header =
    length < 0x80
      ? Buffer.from([tag, length])
      : length < 0x100
        ? Buffer.from([tag, 0x81, length])
        : Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
  return Buffer.concat([header, body]);
};

const sequence = (...content: ReadonlyArray<Buffer>) => tlv(0x30, ...content);

const oid = (dotted: string): Buffer => {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
};

// GeneralizedTime from 2050 on, as RFC 5280 4.1.2.5 requires.
const time = (date: Date): Buffer => {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  return date.getUTCFullYear() >= 2050
    ? tlv(0x18, Buffer.from(iso, "ascii"))
    : tlv(0x17, Buffer.from(iso.slice(2), "ascii"));
};

const ECDSA_WITH_SHA256 = sequence(oid("1.2.840.10045.4.3.2"));
const NAME = sequence(
  tlv(0x31, sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from("CMDeck LAN fallback", "utf8")))),
);
const VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * A self-signed P-256 certificate for the LAN fallback listener. Clients trust it only by
 * its pinned SHA-256, never by name or issuer, so it carries no extensions.
 */
export function makeLanCertificate(nowMs: number): LanCertificate {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  // Positive 16-byte serial: clear the top bit so DER does not read it as negative.
  const serial = NodeCrypto.randomBytes(16);
  serial[0] = serial[0]! & 0x7f;
  const tbs = sequence(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, serial),
    ECDSA_WITH_SHA256,
    NAME,
    sequence(time(new Date(nowMs)), time(new Date(nowMs + VALIDITY_MS))),
    NAME,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = NodeCrypto.sign("sha256", tbs, privateKey);
  const der = sequence(tbs, ECDSA_WITH_SHA256, tlv(0x03, Buffer.from([0]), signature));
  const base64 = der.toString("base64").replace(/.{1,64}/g, "$&\n");
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certPem: `-----BEGIN CERTIFICATE-----\n${base64}-----END CERTIFICATE-----\n`,
  };
}

/** Lowercase hex SHA-256 of the certificate's DER bytes. */
export const certificateSha256 = (certPem: string): string =>
  new NodeCrypto.X509Certificate(certPem).fingerprint256.replaceAll(":", "").toLowerCase();

/** A stored certificate is reused until it expires or no longer parses. */
export function isUsableCertificate(certificate: LanCertificate, nowMs: number): boolean {
  try {
    const parsed = new NodeCrypto.X509Certificate(certificate.certPem);
    return (
      new Date(parsed.validTo).getTime() > nowMs &&
      parsed.checkPrivateKey(NodeCrypto.createPrivateKey(certificate.keyPem))
    );
  } catch {
    return false;
  }
}
