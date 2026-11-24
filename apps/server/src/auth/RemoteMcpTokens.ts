import { AuthMcpClientAccess } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "./ServerSecretStore.ts";
import { base64UrlEncode, timingSafeEqualBase64Url } from "./utils.ts";

/**
 * Static bearer tokens for `/mcp`, for MCP clients that reach this server over Tailscale or a
 * tunnel the user runs and cannot do the OAuth sign-in. Off unless `T3CODE_REMOTE_MCP` is set.
 * Only a SHA-256 of each token is kept; the token is shown once, by `t3 auth mcp-token create`.
 */
export const enabledConfig = Config.Boolean("T3CODE_REMOTE_MCP").pipe(Config.withDefault(false));

const SECRET_NAME = "remote-mcp-tokens";
/** Tells these tokens apart from session and provider tokens without reading the store. */
export const TOKEN_PREFIX = "t3mcp_";
const TOKEN_BYTES = 32;

const RemoteMcpToken = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  access: AuthMcpClientAccess,
  createdAt: Schema.String,
  /** Unpadded base64url SHA-256 of the token. */
  sha256: Schema.String,
});
type RemoteMcpToken = typeof RemoteMcpToken.Type;

const TokenList = Schema.fromJsonString(Schema.Array(RemoteMcpToken));
const decodeTokenList = Schema.decodeUnknownOption(TokenList);
const encodeTokenList = Schema.encodeSync(TokenList);

class RemoteMcpTokenStoreError extends Schema.TaggedError<RemoteMcpTokenStoreError>()(
  "RemoteMcpTokenStoreError",
  {},
) {
  override get message(): string {
    return `The remote MCP token list (secrets/${SECRET_NAME}.bin) is unreadable. Delete it to start over; every token in it stops working.`;
  }
}

const read = Effect.fn("RemoteMcpTokens.read")(function* () {
  const store = yield* ServerSecretStore.ServerSecretStore;
  const bytes = yield* store.get(SECRET_NAME);
  if (Option.isNone(bytes)) return [] as ReadonlyArray<RemoteMcpToken>;
  const tokens = decodeTokenList(new TextDecoder().decode(bytes.value));
  if (Option.isNone(tokens)) return yield* new RemoteMcpTokenStoreError({});
  return tokens.value;
});

const write = (tokens: ReadonlyArray<RemoteMcpToken>) =>
  ServerSecretStore.ServerSecretStore.pipe(
    Effect.flatMap((store) =>
      store.set(SECRET_NAME, new TextEncoder().encode(encodeTokenList(tokens))),
    ),
  );

const sha256 = (token: string) =>
  Digest.Digest.pipe(
    Effect.flatMap((digester) =>
      digester.digest(Digest.sha256, new TextEncoder().encode(token)).pipe(Effect.orDie),
    ),
    Effect.map(base64UrlEncode),
  );

export const list = read;

/** Returns the new token once; only its hash is stored. */
export const create = Effect.fn("RemoteMcpTokens.create")(function* (input: {
  readonly label: string;
  readonly access: AuthMcpClientAccess;
}) {
  const random = yield* SecureRandom.SecureRandom;
  const tokens = yield* read();
  const token = `${TOKEN_PREFIX}${base64UrlEncode(yield* random.randomBytes(TOKEN_BYTES))}`;
  const record: RemoteMcpToken = {
    id: base64UrlEncode(yield* random.randomBytes(6)),
    label: input.label,
    access: input.access,
    createdAt: DateTime.formatIso(yield* DateTime.now),
    sha256: yield* sha256(token),
  };
  yield* write([...tokens, record]);
  return { record, token };
});

/** False when no token has this id. */
export const revoke = Effect.fn("RemoteMcpTokens.revoke")(function* (id: string) {
  const tokens = yield* read();
  const kept = tokens.filter((token) => token.id !== id);
  if (kept.length === tokens.length) return false;
  yield* write(kept);
  return true;
});

/**
 * The stored token `token` matches, by hash in constant time. The list is read per call, so a
 * CLI revoke applies at once.
 */
export const verify = Effect.fn("RemoteMcpTokens.verify")(function* (token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return undefined;
  const presented = yield* sha256(token);
  const tokens = yield* read();
  let match: RemoteMcpToken | undefined;
  // Compare every entry so the time taken does not depend on which one matched.
  for (const candidate of tokens) {
    if (timingSafeEqualBase64Url(candidate.sha256, presented)) match = candidate;
  }
  return match;
});
