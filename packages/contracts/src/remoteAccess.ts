import * as Schema from "effect/Schema";

import { AuthMcpClientAccess } from "./auth.ts";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AdvertisedEndpointProviderKind = Schema.Literals([
  "core",
  "private-network",
  "tunnel",
  "manual",
]);
export type AdvertisedEndpointProviderKind = typeof AdvertisedEndpointProviderKind.Type;

export const AdvertisedEndpointReachability = Schema.Literals([
  "loopback",
  "lan",
  "private-network",
  "public",
]);
export type AdvertisedEndpointReachability = typeof AdvertisedEndpointReachability.Type;

export const AdvertisedEndpointHostedHttpsCompatibility = Schema.Literals([
  "compatible",
  "mixed-content-blocked",
  "requires-configuration",
  "unknown",
]);
export type AdvertisedEndpointHostedHttpsCompatibility =
  typeof AdvertisedEndpointHostedHttpsCompatibility.Type;

export const AdvertisedEndpointStatus = Schema.Literals(["available", "unavailable", "unknown"]);
export type AdvertisedEndpointStatus = typeof AdvertisedEndpointStatus.Type;

export const AdvertisedEndpointSource = Schema.Literals([
  "desktop-core",
  "desktop-addon",
  "server",
  "user",
]);
export type AdvertisedEndpointSource = typeof AdvertisedEndpointSource.Type;

export const AdvertisedEndpointProvider = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  kind: AdvertisedEndpointProviderKind,
  isAddon: Schema.Boolean,
});
export type AdvertisedEndpointProvider = typeof AdvertisedEndpointProvider.Type;

export const AdvertisedEndpointCompatibility = Schema.Struct({
  hostedHttpsApp: AdvertisedEndpointHostedHttpsCompatibility,
  desktopApp: Schema.Literals(["compatible", "unknown"]),
});
export type AdvertisedEndpointCompatibility = typeof AdvertisedEndpointCompatibility.Type;

export const AdvertisedEndpoint = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  provider: AdvertisedEndpointProvider,
  httpBaseUrl: TrimmedNonEmptyString,
  wsBaseUrl: TrimmedNonEmptyString,
  reachability: AdvertisedEndpointReachability,
  compatibility: AdvertisedEndpointCompatibility,
  source: AdvertisedEndpointSource,
  status: AdvertisedEndpointStatus,
  isDefault: Schema.optional(Schema.Boolean),
  description: Schema.optional(TrimmedNonEmptyString),
});
export type AdvertisedEndpoint = typeof AdvertisedEndpoint.Type;

export type PublicBaseUrlProblem = "spaces" | "not-https" | "credentials" | "path" | "invalid";

/** Why `value` cannot be a tunnel address, or null when it can (empty means unset). */
export function publicBaseUrlProblem(value: string): PublicBaseUrlProblem | null {
  if (value === "") return null;
  if (value !== value.trim()) return "spaces";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:") return "not-https";
  if (url.username || url.password) return "credentials";
  if (url.pathname !== "/" || url.search || url.hash || /[?#]$/u.test(value)) return "path";
  return null;
}

const PUBLIC_BASE_URL_PROBLEMS = {
  spaces: "Remove the spaces around the address.",
  "not-https": "Use an https:// address.",
  credentials: "Leave the user name and password out.",
  path: "Use only the address, such as https://cmdeck.example.com, without a path.",
  invalid: "Enter an address such as https://cmdeck.example.com.",
} as const satisfies Record<PublicBaseUrlProblem, string>;

/**
 * The https origin of a tunnel the user runs in front of this environment, such as a Cloudflare
 * Tunnel. Empty when unset. Only an origin: no credentials, path, query, or fragment.
 */
export const PublicBaseUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value) => {
    const problem = publicBaseUrlProblem(value);
    return problem === null ? true : PUBLIC_BASE_URL_PROBLEMS[problem];
  }),
);

/** `https://host` without the trailing slash `URL` adds, so paths append cleanly. */
export const publicBaseOrigin = (value: string): string | null =>
  value === "" ? null : new URL(value).origin;

export const RemoteMcpToken = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: Schema.String,
  access: AuthMcpClientAccess,
  createdAt: IsoDateTime,
});
export type RemoteMcpToken = typeof RemoteMcpToken.Type;

export const RemoteMcpStatus = Schema.Struct({
  /** `T3CODE_REMOTE_MCP` when the server started with it set; it wins over the setting. */
  envOverride: Schema.NullOr(Schema.Boolean),
  tokens: Schema.Array(RemoteMcpToken),
});
export type RemoteMcpStatus = typeof RemoteMcpStatus.Type;

export const REMOTE_MCP_TOKEN_LABEL_MAX_LENGTH = 80;
export const RemoteMcpTokenCreateInput = Schema.Struct({
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(REMOTE_MCP_TOKEN_LABEL_MAX_LENGTH)),
  access: AuthMcpClientAccess,
});
export type RemoteMcpTokenCreateInput = typeof RemoteMcpTokenCreateInput.Type;

/** The only response that carries the token itself; the server keeps just its hash. */
export const RemoteMcpTokenCreateResult = Schema.Struct({
  token: RemoteMcpToken,
  secret: Schema.String,
});
export type RemoteMcpTokenCreateResult = typeof RemoteMcpTokenCreateResult.Type;

export const RemoteMcpTokenRevokeInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type RemoteMcpTokenRevokeInput = typeof RemoteMcpTokenRevokeInput.Type;

export const RemoteMcpTokenRevokeResult = Schema.Struct({ revoked: Schema.Boolean });
export type RemoteMcpTokenRevokeResult = typeof RemoteMcpTokenRevokeResult.Type;

export class RemoteMcpTokenError extends Schema.TaggedError<RemoteMcpTokenError>()(
  "RemoteMcpTokenError",
  {
    reason: Schema.Literals(["unreadable", "locked", "storage"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "unreadable":
        return "The remote MCP token list is unreadable. Delete secrets/remote-mcp-tokens.bin to start over; every token in it stops working.";
      case "locked":
        return "Could not lock the remote MCP token list for an update. Try again.";
      case "storage":
        return "Could not read or save the remote MCP token list.";
    }
  }
}

export const PublicAddressCheckInput = Schema.Struct({
  url: PublicBaseUrl.check(Schema.isMinLength(1)),
});
export type PublicAddressCheckInput = typeof PublicAddressCheckInput.Type;

/**
 * What answered at `<url>/.well-known/t3/environment`, asked from the server. `access-login`
 * means Cloudflare Access (or another login gate) stopped the request before it reached here.
 */
export const PublicAddressCheckResult = Schema.Struct({
  status: Schema.Literals(["reachable", "access-login", "other-environment", "unreachable"]),
  httpStatus: Schema.optionalKey(Schema.Int),
});
export type PublicAddressCheckResult = typeof PublicAddressCheckResult.Type;
