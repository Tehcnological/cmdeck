import {
  AuthMcpClientAccess,
  RemoteMcpTokenError,
  type RemoteMcpStatus,
  type RemoteMcpToken as RemoteMcpTokenSummary,
  type RemoteMcpTokenCreateInput,
  type RemoteMcpTokenCreateResult,
  type RemoteMcpTokenRevokeResult,
} from "@t3tools/contracts";
import { lock } from "proper-lockfile";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as AuditLog from "../fork/audit/AuditLog.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import { base64UrlEncode, timingSafeEqualBase64Url } from "./utils.ts";

/**
 * Static bearer tokens for `/mcp`, for MCP clients that reach this server over Tailscale or a
 * tunnel the user runs and cannot do the OAuth sign-in. Off unless the `remoteMcpEnabled` setting
 * is on. Only a SHA-256 of each token is kept; the token is shown once, when it is created.
 */
const envOverrideConfig = Config.option(Config.Boolean("T3CODE_REMOTE_MCP"));

/**
 * `T3CODE_REMOTE_MCP` when set: true or false wins over the setting. A value that is not a
 * boolean keeps tokens off.
 */
export const readEnvOverride = envOverrideConfig.pipe(
  Effect.map(Option.getOrNull),
  Effect.catch((cause) =>
    Effect.logWarning("T3CODE_REMOTE_MCP is not a boolean; remote MCP tokens stay off.", {
      cause,
    }).pipe(Effect.as(false)),
  ),
);

export const isEnabled = (envOverride: boolean | null, setting: boolean): boolean =>
  envOverride ?? setting;

const SECRET_NAME = "remote-mcp-tokens";
/** Tells these tokens apart from session and provider tokens without reading the store. */
export const TOKEN_PREFIX = "t3mcp_";
const TOKEN_BYTES = 32;
const TOKEN_FORMAT = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);
const RECHECK_INTERVAL = "1 second";
// Every MCP request presents its token, so the audit log records use at most this often per token.
const USE_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

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

export class RemoteMcpTokenStoreError extends Schema.TaggedError<RemoteMcpTokenStoreError>()(
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
    Effect.uninterruptible,
  );

export class RemoteMcpTokenLockError extends Schema.TaggedError<RemoteMcpTokenLockError>()(
  "RemoteMcpTokenLockError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not lock the remote MCP token list for an update. Try again.";
  }
}

// The store atomically renames each write. Separate CLI and server processes must also
// serialize the preceding read, including when the first token file does not exist yet.
// `realpath: false` locks `<file>.lock` without needing the file itself.
const withWriteLock = Effect.fn("RemoteMcpTokens.withWriteLock")(function* <A, E, R>(
  update: Effect.Effect<A, E, R>,
) {
  const { directory } = yield* ServerSecretStore.ServerSecretStore;
  // A store without a directory is in memory, so no other process shares it.
  if (directory === undefined) return yield* update;
  const path = yield* Path.Path;
  const file = path.join(directory, `${SECRET_NAME}.bin`);
  const compromised = yield* Deferred.make<never, RemoteMcpTokenLockError>();
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        lock(file, {
          realpath: false,
          retries: { retries: 60, minTimeout: 25, maxTimeout: 250 },
          onCompromised: (cause) =>
            Deferred.doneUnsafe(compromised, Effect.fail(new RemoteMcpTokenLockError({ cause }))),
        }),
      catch: (cause) => new RemoteMcpTokenLockError({ cause }),
    }),
    () => Effect.raceFirst(update, Deferred.await(compromised)),
    (release) => Effect.promise(() => release().catch(() => undefined)),
  );
});

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
  // Here rather than in the service, so the CLI's create is audited too.
  yield* AuditLog.note({
    kind: "mcp_token.created",
    subject: record.id,
    detail: { label: record.label, access: record.access },
  });
  return { record, token };
}, withWriteLock);

/** False when no token has this id. */
export const revoke = Effect.fn("RemoteMcpTokens.revoke")(function* (id: string) {
  const tokens = yield* read();
  const kept = tokens.filter((token) => token.id !== id);
  if (kept.length === tokens.length) return false;
  yield* write(kept);
  yield* AuditLog.note({ kind: "mcp_token.revoked", subject: id });
  return true;
}, withWriteLock);

/** One snapshot per authenticator, shared by incoming requests and open responses. */
export const makeVerifier = Effect.gen(function* () {
  const services = yield* Effect.context<ServerSecretStore.ServerSecretStore | Digest.Digest>();
  const snapshot = yield* read().pipe(
    Effect.provide(services),
    Effect.cachedWithTTL(RECHECK_INTERVAL),
  );
  const lastAuditedUse = new Map<string, number>();
  const auditUse = Effect.fn("RemoteMcpTokens.auditUse")(function* (token: RemoteMcpToken) {
    const now = yield* Clock.currentTimeMillis;
    const last = lastAuditedUse.get(token.id);
    if (last !== undefined && now - last < USE_AUDIT_INTERVAL_MS) return;
    lastAuditedUse.set(token.id, now);
    yield* AuditLog.note({
      kind: "mcp_token.used",
      subject: token.id,
      detail: { label: token.label },
    });
  });
  const verify = Effect.fn("RemoteMcpTokens.verify")(function* (token: string) {
    if (!TOKEN_FORMAT.test(token)) return undefined;
    const tokens = yield* snapshot;
    if (tokens.length === 0) return undefined;
    const presented = yield* sha256(token).pipe(Effect.provide(services));
    let match: RemoteMcpToken | undefined;
    // Compare every entry so the time taken does not depend on which one matched.
    for (const candidate of tokens) {
      if (timingSafeEqualBase64Url(candidate.sha256, presented)) match = candidate;
    }
    if (match !== undefined) yield* auditUse(match);
    return match;
  });
  const awaitRevocation = (id: string) =>
    snapshot.pipe(
      Effect.repeat({
        schedule: Schedule.spaced(RECHECK_INTERVAL),
        while: (tokens) => tokens.some((candidate) => candidate.id === id),
      }),
      Effect.ignore,
    );
  return { verify, awaitRevocation };
});

const toPublic = ({ id, label, access, createdAt }: RemoteMcpToken): RemoteMcpTokenSummary => ({
  id,
  label,
  access,
  createdAt,
});

const isStoreError = Schema.is(RemoteMcpTokenStoreError);
const isLockError = Schema.is(RemoteMcpTokenLockError);

const toServiceError = (cause: unknown) =>
  new RemoteMcpTokenError({
    reason: isStoreError(cause) ? "unreadable" : isLockError(cause) ? "locked" : "storage",
    cause,
  });

/** Token management for the environment's owner in Settings; the CLI uses the functions above. */
export class RemoteMcpTokens extends Context.Service<
  RemoteMcpTokens,
  {
    readonly status: Effect.Effect<RemoteMcpStatus, RemoteMcpTokenError>;
    readonly create: (
      input: RemoteMcpTokenCreateInput,
    ) => Effect.Effect<RemoteMcpTokenCreateResult, RemoteMcpTokenError>;
    readonly revoke: (id: string) => Effect.Effect<RemoteMcpTokenRevokeResult, RemoteMcpTokenError>;
  }
>()("t3/auth/RemoteMcpTokens") {}

const make = Effect.gen(function* () {
  const services = yield* Effect.context<
    ServerSecretStore.ServerSecretStore | Digest.Digest | SecureRandom.SecureRandom | Path.Path
  >();
  const envOverride = yield* readEnvOverride;

  const status = list().pipe(
    Effect.map((tokens) => ({ envOverride, tokens: tokens.map(toPublic) })),
    Effect.mapError(toServiceError),
    Effect.provide(services),
    Effect.withSpan("RemoteMcpTokens.status"),
  );

  const createToken = Effect.fn("RemoteMcpTokens.createToken")(
    function* (input: RemoteMcpTokenCreateInput) {
      const { record, token } = yield* create(input);
      return { token: toPublic(record), secret: token };
    },
    Effect.mapError(toServiceError),
    Effect.provide(services),
  );

  const revokeToken = Effect.fn("RemoteMcpTokens.revokeToken")(
    function* (id: string) {
      const revoked = yield* revoke(id);
      return { revoked };
    },
    Effect.mapError(toServiceError),
    Effect.provide(services),
  );

  return RemoteMcpTokens.of({ status, create: createToken, revoke: revokeToken });
});

export const layer = Layer.effect(RemoteMcpTokens, make);
