// @effect-diagnostics nodeBuiltinImport:off -- drives real TLS sockets against the listener.
import { assert, describe, it } from "@effect/vitest";
import type { ServerConfig, ServerDirectEndpoint } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeTls from "node:tls";

import { certificateSha256, isUsableCertificate, makeLanCertificate } from "./certificate.ts";
import { withLateConfigDiscovery } from "../../ws.ts";
import * as LanFallback from "./LanFallback.ts";
import { layerLanFallbackTest } from "./lanFallback.testkit.ts";

describe("isLanAddress", () => {
  it.each([
    ["10.0.0.5", true],
    ["172.16.4.2", true],
    ["172.31.255.1", true],
    ["192.168.1.20", true],
    ["::ffff:192.168.1.20", true],
    ["fd12:3456::1", true],
    ["fc00::1", true],
    ["172.32.0.1", false],
    ["100.101.102.103", false],
    ["fd7a:115c:a1e0::1", false],
    ["169.254.1.1", false],
    ["fe80::1", false],
    ["127.0.0.1", false],
    ["::1", false],
    ["8.8.8.8", false],
    ["2001:db8::1", false],
  ] as const)("%s is LAN: %s", (address, expected) => {
    assert.strictEqual(LanFallback.isLanAddress(address), expected);
  });
});

describe("lanAddresses", () => {
  const entry = (address: string, extra: object = {}) => ({
    address,
    netmask: "255.255.255.0",
    family: address.includes(":") ? ("IPv6" as const) : ("IPv4" as const),
    mac: "aa:bb:cc:dd:ee:ff",
    internal: false,
    cidr: null,
    scopeid: 0,
    ...extra,
  });

  it("keeps LAN addresses and skips loopback, tailnet, virtual, public and link-local", () => {
    const addresses = LanFallback.lanAddresses(
      {
        eth0: [entry("192.168.1.20"), entry("fe80::1"), entry("fd12::20"), entry("8.8.4.4")],
        lo: [entry("127.0.0.1", { internal: true })],
        tailscale0: [entry("100.64.0.2"), entry("fd7a:115c:a1e0::2")],
        docker0: [entry("172.17.0.1")],
        "vEthernet (WSL)": [entry("172.20.0.1")],
      },
      "linux",
    );
    assert.deepStrictEqual(addresses, ["192.168.1.20", "fd12::20"]);
  });
});

describe("certificate", () => {
  it("pins the DER SHA-256 and expires after its validity", () => {
    const now = Date.parse("2026-11-28T00:00:00Z");
    const certificate = makeLanCertificate(now);
    assert.match(certificateSha256(certificate.certPem), /^[0-9a-f]{64}$/);
    assert.isTrue(isUsableCertificate(certificate, now));
    assert.isFalse(isUsableCertificate(certificate, now + 11 * 365 * 24 * 60 * 60 * 1000));
    const other = makeLanCertificate(now);
    assert.isFalse(isUsableCertificate({ ...certificate, keyPem: other.keyPem }, now));
  });
});

/** An HTTPS GET to `url` that reports the body and the SHA-256 of the certificate it was served. */
const fetchPinned = (url: string) =>
  Effect.callback<{ readonly body: string; readonly sha256: string }, Error>((resume) => {
    const request = NodeHttps.get(url, { rejectUnauthorized: false, agent: false }, (response) => {
      const socket = response.socket as NodeTls.TLSSocket;
      const sha256 = socket.getPeerCertificate().fingerprint256.replaceAll(":", "").toLowerCase();
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resume(Effect.succeed({ body, sha256 })));
    });
    request.on("error", (error) => resume(Effect.fail(error)));
  });

/** Opens a TLS connection and returns an effect that completes once the server closes it. */
const holdConnection = (url: string) =>
  Effect.callback<Effect.Effect<void>, Error>((resume) => {
    const { hostname, port } = new URL(url);
    const socket = NodeTls.connect({
      host: hostname,
      port: Number(port),
      rejectUnauthorized: false,
    });
    const closed = Effect.callback<void>((done) => {
      if (socket.destroyed) return done(Effect.void);
      socket.once("close", () => done(Effect.void));
    });
    socket.once("secureConnect", () => resume(Effect.succeed(closed)));
    socket.once("error", (error: Error) => resume(Effect.fail(error)));
  });

const awaitEndpoints = (
  lan: LanFallback.LanFallbackShape,
  predicate: (endpoints: ReadonlyArray<ServerDirectEndpoint>) => boolean,
) =>
  lan.changes.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map((found) => (found._tag === "Some" ? found.value : [])),
  );

describe("LanFallback", () => {
  const primary = NodeHttp.createServer((request, response) =>
    response.end(`primary ${request.socket.remoteAddress}`),
  );

  it.live("serves the primary server over pinned TLS while on, and nothing once off", () =>
    Effect.gen(function* () {
      const enabled = yield* SubscriptionRef.make(false);
      const secrets = new Map<string, Uint8Array>();
      yield* Effect.gen(function* () {
        const lan = yield* LanFallback.LanFallback;
        assert.deepStrictEqual(yield* lan.endpoints, []);

        yield* SubscriptionRef.set(enabled, true);
        const [endpoint] = yield* awaitEndpoints(lan, (endpoints) => endpoints.length > 0);
        assert.strictEqual(endpoint?.kind, "lan-tls");
        assert.match(endpoint!.httpBaseUrl, /^https:\/\/127\.0\.0\.1:\d+\/$/);

        const served = yield* fetchPinned(endpoint!.httpBaseUrl);
        assert.strictEqual(served.body, "primary 127.0.0.1");
        assert.strictEqual(served.sha256, endpoint!.certificateSha256);

        // A connected desktop holds its socket open; turning the setting off still ends it.
        const held = yield* holdConnection(endpoint!.httpBaseUrl);
        yield* SubscriptionRef.set(enabled, false);
        yield* awaitEndpoints(lan, (endpoints) => endpoints.length === 0);
        yield* held;
        const refused = yield* Effect.flip(fetchPinned(endpoint!.httpBaseUrl));
        assert.match(refused.message, /ECONNREFUSED/);

        // Turned on again, it keeps the stored certificate and port.
        yield* SubscriptionRef.set(enabled, true);
        const [again] = yield* awaitEndpoints(lan, (endpoints) => endpoints.length > 0);
        assert.deepStrictEqual(again, endpoint);
      }).pipe(
        Effect.provide(
          layerLanFallbackTest({
            enabled,
            secrets,
            lan: {
              addresses: () => ["127.0.0.1"],
              acceptsPeer: () => true,
              primaryServer: () => primary,
            },
          }),
        ),
      );
    }),
  );

  it.live("closes a connection from outside the LAN before any request is read", () =>
    Effect.gen(function* () {
      const enabled = yield* SubscriptionRef.make(true);
      yield* Effect.gen(function* () {
        const lan = yield* LanFallback.LanFallback;
        const [endpoint] = yield* awaitEndpoints(lan, (endpoints) => endpoints.length > 0);
        const refused = yield* Effect.flip(fetchPinned(endpoint!.httpBaseUrl));
        assert.match(refused.message, /socket hang up|ECONNRESET/);
      }).pipe(
        Effect.provide(
          layerLanFallbackTest({
            enabled,
            secrets: new Map(),
            lan: {
              addresses: () => ["127.0.0.1"],
              acceptsPeer: LanFallback.isLanAddress,
              primaryServer: () => primary,
            },
          }),
        ),
      );
    }),
  );

  it.effect("re-advertises on the next poll when an address goes away", () =>
    Effect.gen(function* () {
      const enabled = yield* SubscriptionRef.make(true);
      const addresses = ["127.0.0.1"];
      yield* Effect.gen(function* () {
        const lan = yield* LanFallback.LanFallback;
        const [endpoint] = yield* awaitEndpoints(lan, (endpoints) => endpoints.length === 1);
        addresses.length = 0;
        yield* TestClock.adjust("30 seconds");
        yield* awaitEndpoints(lan, (endpoints) => endpoints.length === 0);
        const refused = yield* Effect.flip(fetchPinned(endpoint!.httpBaseUrl));
        assert.match(refused.message, /ECONNREFUSED/);
      }).pipe(
        Effect.provide(
          layerLanFallbackTest({
            enabled,
            secrets: new Map(),
            lan: {
              addresses: () => addresses,
              acceptsPeer: () => true,
              primaryServer: () => primary,
            },
          }),
        ),
      );
    }),
  );
});

it.effect("a changed LAN advertisement reaches a subscribed client as a new snapshot", () =>
  Effect.gen(function* () {
    const tailnet = { kind: "tailnet", httpBaseUrl: "https://box.example.ts.net/" } as const;
    const pinned = {
      kind: "lan-tls",
      httpBaseUrl: "https://192.168.1.20:4000/",
      certificateSha256: "a".repeat(64),
    } as const;
    const advertised = yield* SubscriptionRef.make<ReadonlyArray<ServerDirectEndpoint>>([]);
    const direct = LanFallback.withLanFallback(
      {
        resolve: () => Effect.succeed([tailnet]),
        resolveAvailable: () => Effect.succeed([tailnet]),
      },
      { endpoints: SubscriptionRef.get(advertised), changes: SubscriptionRef.changes(advertised) },
    );
    const snapshot = yield* withLateConfigDiscovery(
      { availableEditors: [], settings: {}, directEndpoints: [tailnet] } as unknown as ServerConfig,
      Stream.empty,
      {
        resolveAvailableEditors: () => Effect.succeed([]),
        resolveFileManagerRevealKind: () => Effect.undefined,
      },
      { resolveTargets: () => Effect.succeed([]) },
      direct,
    ).pipe(
      Stream.filter((event) => event.type === "snapshot"),
      Stream.runHead,
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* SubscriptionRef.set(advertised, [pinned]);
    const event = yield* Fiber.join(snapshot);
    assert.deepStrictEqual(
      event._tag === "Some" && event.value.type === "snapshot"
        ? event.value.config.directEndpoints
        : null,
      [tailnet, pinned],
    );
  }),
);
