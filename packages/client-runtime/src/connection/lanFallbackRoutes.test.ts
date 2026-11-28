// Fork: LAN fallback. Pinned LAN routes learned from a Tailscale-paired environment.
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { BearerConnectionTarget } from "./model.ts";
import {
  connectionRouteId,
  connectionRouteLabel,
  connectionRoutes,
  isPinnedLanRoute,
  mergeLearnedRoutes,
  type ReportedEndpoint,
  sendsTokenInClear,
  usableRoutes,
  entryWithRoutes,
} from "./routes.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-lan");
const PIN = "a".repeat(64);

const bearerRoute = (connectionId: string, httpBaseUrl: string): ConnectionRoute => {
  const target = new BearerConnectionTarget({
    environmentId: ENVIRONMENT_ID,
    label: "Box",
    connectionId,
  });
  return {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId,
        environmentId: ENVIRONMENT_ID,
        label: "Box",
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
      }),
    ),
  };
};

const TAILSCALE_HTTPS = bearerRoute("bearer:tailnet", "https://box.example.ts.net/");
const PAIRED: ConnectionCatalogEntry = { ...TAILSCALE_HTTPS, enabled: true };
const PINNED: ReportedEndpoint = {
  kind: "lan-tls",
  httpBaseUrl: "https://192.168.1.10:4000/",
  certificateSha256: PIN,
};

const learn = (
  reported: ReadonlyArray<ReportedEndpoint>,
  options: { readonly entry?: ConnectionCatalogEntry; readonly pinsCertificates?: boolean } = {},
) =>
  mergeLearnedRoutes({
    entry: options.entry ?? PAIRED,
    activeRoute: TAILSCALE_HTTPS,
    reported,
    allowInsecure: true,
    pinsCertificates: options.pinsCertificates ?? true,
  });

const pinOf = (route: ConnectionRoute | undefined) => {
  const profile = route === undefined ? null : Option.getOrNull(route.profile);
  return profile?._tag === "BearerConnectionProfile" ? profile.certificateSha256 : undefined;
};

describe("pinned LAN routes", () => {
  it("are learned on desktop as an HTTPS backup behind the paired route", () => {
    const routes = learn([
      { kind: "tailnet", httpBaseUrl: "https://box.example.ts.net/" },
      PINNED,
    ])!;
    expect(routes.map((route) => connectionRouteId(route.target))).toEqual([
      "bearer:tailnet",
      `learned:${ENVIRONMENT_ID}:https://192.168.1.10:4000@bearer:tailnet`,
    ]);
    const pinned = routes[1]!;
    expect(isPinnedLanRoute(pinned)).toBe(true);
    expect(pinOf(pinned)).toBe(PIN);
    expect(connectionRouteLabel(pinned)).toBe("LAN fallback");
    expect(sendsTokenInClear(routes, pinned)).toBe(false);
    expect(usableRoutes(entryWithRoutes(PAIRED, routes))).toContain(pinned);
  });

  it("stay behind a plain LAN route the user paired later", () => {
    const routes = learn([PINNED])!;
    const lanPaired = bearerRoute("bearer:lan", "http://192.168.1.10:3773/");
    const entry = entryWithRoutes(PAIRED, [lanPaired, ...routes]);
    const again = learn([PINNED], { entry });
    expect(again).toBeNull();
    expect(isPinnedLanRoute(connectionRoutes(entry).at(-1)!)).toBe(true);
  });

  it("are not learned where the platform cannot verify a pin (web, mobile)", () => {
    expect(learn([PINNED], { pinsCertificates: false })).toBeNull();
    expect(
      mergeLearnedRoutes({
        entry: PAIRED,
        activeRoute: TAILSCALE_HTTPS,
        reported: [PINNED],
        allowInsecure: true,
      }),
    ).toBeNull();
  });

  it.each([
    ["plain HTTP", { ...PINNED, httpBaseUrl: "http://192.168.1.10:4000/" }],
    ["a tailnet address", { ...PINNED, httpBaseUrl: "https://100.101.102.103:4000/" }],
    ["a public address", { ...PINNED, httpBaseUrl: "https://203.0.113.9:4000/" }],
    ["a public name", { ...PINNED, httpBaseUrl: "https://box.example.com:4000/" }],
    ["no pin", { kind: "lan-tls", httpBaseUrl: PINNED.httpBaseUrl }],
    ["a malformed pin", { ...PINNED, certificateSha256: "A".repeat(64) }],
  ] as const)("refuse a pin on %s", (_name, endpoint) => {
    expect(learn([endpoint])).toBeNull();
  });

  it("never let a token paired over HTTPS reach a plain HTTP LAN address", () => {
    expect(learn([{ kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" }])).toBeNull();
  });

  it("take a rotated certificate's new pin and drop an address that is no longer served", () => {
    const routes = learn([PINNED])!;
    const entry = entryWithRoutes(PAIRED, routes);
    const NEW_PIN = "b".repeat(64);
    const rotated = learn([{ ...PINNED, certificateSha256: NEW_PIN }], { entry })!;
    expect(rotated).toHaveLength(2);
    expect(pinOf(rotated[1])).toBe(NEW_PIN);
    expect(learn([], { entry })).toEqual([TAILSCALE_HTTPS]);
  });
});
