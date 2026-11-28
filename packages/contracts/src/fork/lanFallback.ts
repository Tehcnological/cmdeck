import * as Schema from "effect/Schema";

/** Lowercase hex SHA-256 of a certificate's DER bytes, the pin for a LAN fallback route. */
export const CertificateSha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export type CertificateSha256 = typeof CertificateSha256.Type;
