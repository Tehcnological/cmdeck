import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const MAX_HEARTBEAT_PROBES = 20;

export type HeartbeatProbeTarget =
  | { readonly kind: "http"; readonly url: string }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number };

/**
 * An `http(s)://` URL, or `tcp://host:port` (also bare `host:port`); returns why anything else,
 * such as `file:` or `data:`, cannot be probed.
 */
export function parseHeartbeatProbeTarget(target: string): HeartbeatProbeTarget | string {
  const text = target.trim();
  const tcp = /^(?:tcp:\/\/)?(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})\/?$/i.exec(text);
  if (tcp !== null) {
    const port = Number(tcp[2]);
    return port >= 1 && port <= 65_535
      ? { kind: "tcp", host: tcp[1]!.replace(/^\[|\]$/g, ""), port }
      : "A TCP port is a number from 1 to 65535.";
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter an http:// or https:// URL, or host:port for a TCP check.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http://, https:// and tcp:// targets can be checked.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Leave credentials out of the URL; the check only needs an answer.";
  }
  return { kind: "http", url: url.href };
}

export const HeartbeatProbe = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  target: TrimmedNonEmptyString.check(
    Schema.makeFilter((value) => {
      const parsed = parseHeartbeatProbeTarget(value);
      return typeof parsed === "string" ? parsed : true;
    }),
  ),
});
export type HeartbeatProbe = typeof HeartbeatProbe.Type;

const StallMinutes = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 240 }));
const Probes = Schema.Array(HeartbeatProbe).check(Schema.isMaxLength(MAX_HEARTBEAT_PROBES));

const DEFAULT_SESSION_STALL_MINUTES = 15;

/**
 * Health monitoring (WI-2.12): a deterministic check that running turns still hear from their
 * provider, linked environments answer, and the user's probes answer. Off until turned on; with
 * it on, only the listed probes and, when asked, linked environments are contacted.
 */
export const HeartbeatSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Also ask each linked environment whether it answers, as Settings > Linked environments does. */
  environments: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** A running turn with no provider event for this long counts as not responding. */
  sessionStallMinutes: StallMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SESSION_STALL_MINUTES)),
  ),
  probes: Probes.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type HeartbeatSettings = typeof HeartbeatSettings.Type;

export const HeartbeatSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  environments: Schema.optionalKey(Schema.Boolean),
  sessionStallMinutes: Schema.optionalKey(StallMinutes),
  probes: Schema.optionalKey(Probes),
});

export const HeartbeatCheckKind = Schema.Literals(["session", "environment", "probe"]);
export type HeartbeatCheckKind = typeof HeartbeatCheckKind.Type;

export const HeartbeatCheck = Schema.Struct({
  key: Schema.String,
  kind: HeartbeatCheckKind,
  label: Schema.String,
  up: Schema.Boolean,
  /** When it last changed between answering and not, in epoch milliseconds. */
  since: Schema.Number,
  checkedAt: Schema.Number,
  detail: Schema.NullOr(Schema.String),
});
export type HeartbeatCheck = typeof HeartbeatCheck.Type;

export const HeartbeatStatus = Schema.Struct({
  enabled: Schema.Boolean,
  checks: Schema.Array(HeartbeatCheck),
});
export type HeartbeatStatus = typeof HeartbeatStatus.Type;

export class HeartbeatError extends Schema.TaggedError<HeartbeatError>()("HeartbeatError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
