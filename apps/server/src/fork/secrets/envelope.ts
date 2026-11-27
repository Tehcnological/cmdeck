// @effect-diagnostics nodeBuiltinImport:off - AES-256-GCM is synchronous Node crypto with no Effect wrapper.
// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/secrets/vault.py (Apache-2.0).
// Changes: one binary envelope per secret file instead of a JSON map of entries; the AAD scope is
// "cmdeck" and has no item type; errors carry no ciphertext, plaintext or name.
import * as NodeCrypto from "node:crypto";

export const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
// A leading NUL keeps any text secret from matching; a random 32-byte key matches with p = 2^-48.
const MAGIC = Uint8Array.from([0x00, 0x43, 0x4d, 0x44, 0x53, 0x01]); // "\0CMDS" + version 1
const HEADER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES;

export const isEnvelope = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= HEADER_BYTES && MAGIC.every((byte, index) => bytes[index] === byte);

/** Binds the ciphertext to its secret name, so a file copied over another name fails to open. */
const aadFor = (name: string): Buffer =>
  Buffer.concat([Buffer.from("v1cmdeck"), Buffer.from([0]), Buffer.from(name, "utf8")]);

/** `MAGIC | nonce | tag | ciphertext`. */
export const seal = (key: Uint8Array, name: string, plaintext: Uint8Array): Uint8Array => {
  const nonce = NodeCrypto.randomBytes(NONCE_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aadFor(name));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Uint8Array.from(Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]));
};

/** The plaintext, or `undefined` when the key, the name or the bytes do not match. */
export const open = (
  key: Uint8Array,
  name: string,
  envelope: Uint8Array,
): Uint8Array | undefined => {
  if (!isEnvelope(envelope)) return undefined;
  const bytes = Buffer.from(envelope);
  const nonce = bytes.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  const tag = bytes.subarray(MAGIC.length + NONCE_BYTES, HEADER_BYTES);
  try {
    const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadFor(name));
    decipher.setAuthTag(tag);
    return Uint8Array.from(
      Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]),
    );
  } catch {
    return undefined;
  }
};
