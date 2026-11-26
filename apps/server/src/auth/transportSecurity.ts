import type { RemoteTransportPolicy } from "@t3tools/contracts";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Option from "effect/Option";

import {
  isLocalLoopbackHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@t3tools/shared/hostClassification";

/**
 * How a request reached this server. SSH port-forwards present as loopback
 * traffic, so they count as `loopback`; the client labels them separately.
 */
export type RequestTransportKind = "loopback" | "tailscale" | "tunnel" | "lan-or-proxy";

type Headers = HttpServerRequest.HttpServerRequest["headers"];

const header = (headers: Headers, name: string): string | undefined => {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
};

/** Cloudflare (`cf-*`) and Tailscale Funnel mark traffic that came in from the internet. */
const isTunnelHeader = (name: string): boolean =>
  name.startsWith("cf-") || name === "tailscale-funnel-request";

/** Any header a proxy adds about the hop it forwarded. */
const isForwardingHeader = (name: string): boolean =>
  isTunnelHeader(name) ||
  name.startsWith("x-forwarded-") ||
  name === "forwarded" ||
  name === "x-real-ip" ||
  name === "true-client-ip";

const stripAddress = (value: string): string =>
  value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^\[([^\]]*)\](:\d+)?$/, "$1")
    .replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1")
    .replace(/^::ffff:/i, "");

const lastListEntry = (value: string): string | undefined => {
  const entries = value.split(",");
  const last = entries[entries.length - 1]?.trim();
  return last ? last : undefined;
};

/** `Forwarded: for=1.2.3.4, for="[::1]"` (RFC 7239): the right-most `for=`. */
const lastForwardedFor = (value: string): string | undefined => {
  const last = lastListEntry(value);
  const match = last
    ?.split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.toLowerCase().startsWith("for="));
  return match?.slice(4);
};

/**
 * The client addresses a loopback proxy reported for the hop it accepted. Each
 * header's right-most entry is the one the nearest proxy appended; entries to
 * its left came from the remote client and are never trusted.
 */
const proxiedClientAddresses = (headers: Headers): ReadonlyArray<string | undefined> => {
  const reported: Array<string | undefined> = [];
  const xff = header(headers, "x-forwarded-for");
  if (xff !== undefined) reported.push(lastListEntry(xff));
  const forwarded = header(headers, "forwarded");
  if (forwarded !== undefined) reported.push(lastForwardedFor(forwarded));
  const realIp = header(headers, "x-real-ip");
  if (realIp !== undefined) reported.push(realIp);
  const trueClientIp = header(headers, "true-client-ip");
  if (trueClientIp !== undefined) reported.push(trueClientIp);
  return reported.map((address) => (address === undefined ? undefined : stripAddress(address)));
};

// Tailscale's IPv4 range is the 100.64.0.0/10 carrier-grade NAT block, which other
// CGNAT VPNs and some ISPs also use; such peers count as Tailscale here.
const isTailscaleAddress = (address: string): boolean =>
  isSharedAddressSpaceHost(address) || isTailnetHost(address);

/**
 * Fails closed: forwarding headers count only from a loopback peer, only their right-most entry,
 * and a proxied loopback request is never plain `loopback`. Limitation: a local forwarder that
 * adds no headers (socat, `ssh -R`) looks local and passes the remote client's headers through.
 */
export const classifyRequestTransport = (
  request: Pick<HttpServerRequest.HttpServerRequest, "remoteAddress" | "headers">,
): RequestTransportKind => {
  const headers = request.headers;
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  if (names.some(isTunnelHeader)) return "tunnel";
  const proxied = names.some(isForwardingHeader);
  const peer = Option.getOrUndefined(request.remoteAddress);
  if (peer === undefined) return "lan-or-proxy";
  const normalizedPeer = stripAddress(peer);
  if (isLocalLoopbackHost(normalizedPeer)) {
    if (!proxied) return "loopback";
    const reported = proxiedClientAddresses(headers);
    return reported.length > 0 &&
      reported.every((address) => address !== undefined && isTailscaleAddress(address))
      ? "tailscale"
      : "lan-or-proxy";
  }
  if (!proxied && isTailscaleAddress(normalizedPeer)) return "tailscale";
  return "lan-or-proxy";
};

/** Transports a `private-e2ee-only` server answers. */
export const isPrivateTransport = (kind: RequestTransportKind): boolean =>
  kind === "loopback" || kind === "tailscale";

export const transportAllowedByPolicy = (
  kind: RequestTransportKind,
  policy: RemoteTransportPolicy,
): boolean => policy === "any" || isPrivateTransport(kind);
