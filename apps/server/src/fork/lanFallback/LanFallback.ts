// @effect-diagnostics nodeBuiltinImport:off -- TLS listeners hand raw sockets to the Node HTTP server.
// LAN fallback: an opt-in HTTPS listener on this machine's LAN addresses, pinned by the
// desktop client, so a Tailscale-paired client keeps working on the same LAN when Tailscale is off.
import type { ServerDirectEndpoint } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { formatHostForUrl, isTailnetHost } from "@t3tools/shared/hostClassification";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodeTls from "node:tls";

import type * as DirectEndpoints from "../../environment/DirectEndpoints.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { isVirtualInterface, WINDOWS_HOST_ADAPTER_MAC } from "../../startupAccess.ts";
import { ServerSecretStore } from "../secrets/EncryptedSecretStore.ts";
import {
  certificateSha256,
  isUsableCertificate,
  type LanCertificate,
  makeLanCertificate,
} from "./certificate.ts";

const SECRET_NAME = "lan-fallback-tls";
const ADDRESS_POLL = "30 seconds";

export interface LanFallbackShape {
  /** The pinned LAN endpoints this server serves now; empty while the setting is off. */
  readonly endpoints: Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
  /** The current endpoints, then each change: an address came or went, or the certificate rotated. */
  readonly changes: Stream.Stream<ReadonlyArray<ServerDirectEndpoint>>;
}

export class LanFallback extends Context.Reference<LanFallbackShape>(
  "t3/fork/lanFallback/LanFallback",
  {
    defaultValue: () => ({ endpoints: Effect.succeed([]), changes: Stream.empty }),
  },
) {}

let adoptedServer: NodeHttp.Server | undefined;
/**
 * Hook from server.ts. LAN TLS connections are handed to this server, so they get exactly the
 * routes, auth and limits of every other connection. shortcut: one server per process.
 */
export const adoptPrimaryServer = (server: NodeHttp.Server): void => {
  adoptedServer = server;
};

/** RFC 1918 IPv4 or ULA IPv6 (fc00::/7) outside the tailnet. Loopback, link-local, CGNAT and public are not LAN. */
export const isLanAddress = (address: string): boolean => {
  const plain = address.replace(/^::ffff:/i, "");
  if (NodeNet.isIPv4(plain)) {
    const [a = 0, b = 0] = plain.split(".").map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return NodeNet.isIPv6(plain) && /^f[cd][0-9a-f]{2}:/i.test(plain) && !isTailnetHost(plain);
};

export function lanAddresses(
  interfaces: ReturnType<typeof NodeOS.networkInterfaces>,
  platform: NodeJS.Platform,
): ReadonlyArray<string> {
  const addresses = Object.entries(interfaces).flatMap(([name, entries = []]) =>
    isVirtualInterface(name, platform) || /^tailscale/i.test(name)
      ? []
      : entries
          .filter(
            (entry) =>
              !entry.internal &&
              isLanAddress(entry.address) &&
              !(platform === "win32" && WINDOWS_HOST_ADAPTER_MAC.test(entry.mac)),
          )
          .map((entry) => entry.address),
  );
  return [...new Set(addresses)].toSorted();
}

interface StoredState extends LanCertificate {
  readonly port: number;
}

const decodeState = (bytes: Uint8Array): StoredState | null => {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<StoredState>;
    return typeof value.keyPem === "string" &&
      typeof value.certPem === "string" &&
      Number.isInteger(value.port)
      ? { keyPem: value.keyPem, certPem: value.certPem, port: value.port! }
      : null;
  } catch {
    return null;
  }
};

const listen = (server: NodeTls.Server, host: string, port: number) =>
  Effect.callback<number, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error));
    server.once("error", onError);
    server.listen({ host, port, exclusive: true }, () => {
      server.off("error", onError);
      resume(Effect.succeed((server.address() as NodeNet.AddressInfo).port));
    });
  });

const openSockets = new WeakMap<NodeTls.Server, Set<NodeNet.Socket>>();

const close = (server: NodeTls.Server) =>
  Effect.callback<void>((resume) => {
    server.close(() => resume(Effect.void));
    // Close waits for open connections, and a connected desktop keeps its socket open.
    for (const socket of openSockets.get(server) ?? []) socket.destroy();
  });

export interface LanFallbackOptions {
  readonly addresses: () => ReadonlyArray<string>;
  readonly acceptsPeer: (address: string) => boolean;
  readonly primaryServer: () => NodeHttp.Server | undefined;
}

const make = Effect.fn("LanFallback.make")(function* (options: LanFallbackOptions) {
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* ServerSecretStore;
  const endpoints = yield* SubscriptionRef.make<ReadonlyArray<ServerDirectEndpoint>>([]);

  const publish = (next: ReadonlyArray<ServerDirectEndpoint>) =>
    SubscriptionRef.update(endpoints, (previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );

  const save = (state: StoredState) =>
    secrets.set(SECRET_NAME, new TextEncoder().encode(JSON.stringify(state)));

  const loadState = Effect.gen(function* () {
    const stored = Option.flatMap(yield* secrets.get(SECRET_NAME), (bytes) =>
      Option.fromNullishOr(decodeState(bytes)),
    );
    const now = yield* Clock.currentTimeMillis;
    if (Option.isSome(stored) && isUsableCertificate(stored.value, now)) {
      return stored.value;
    }
    const fresh = { ...makeLanCertificate(now), port: 0 };
    yield* save(fresh);
    return fresh;
  });

  // Runs only while the setting is on; interrupting it closes every listener.
  const serve = Effect.gen(function* () {
    let state = yield* loadState;
    const listeners = new Map<string, NodeTls.Server>();
    yield* Effect.addFinalizer(() =>
      Effect.forEach([...listeners.values()], close, { discard: true }).pipe(
        Effect.andThen(publish([])),
      ),
    );

    const open = Effect.fn("LanFallback.open")(function* (address: string, port: number) {
      const server = NodeTls.createServer(
        { key: state.keyPem, cert: state.certPem, ALPNProtocols: ["http/1.1"] },
        (socket) => {
          const primary = options.primaryServer();
          if (primary === undefined || !options.acceptsPeer(socket.remoteAddress ?? "")) {
            socket.destroy();
            return;
          }
          primary.emit("connection", socket);
        },
      );
      const sockets = new Set<NodeNet.Socket>();
      openSockets.set(server, sockets);
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      return yield* listen(server, address, port).pipe(
        Effect.map((bound) => {
          listeners.set(address, server);
          return bound;
        }),
        Effect.tapError((error) =>
          Effect.logWarning("LAN fallback could not listen", { address, port, error }),
        ),
        Effect.option,
      );
    });

    const sync = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (!isUsableCertificate(state, now)) {
        state = { ...makeLanCertificate(now), port: state.port };
        yield* save(state);
        for (const server of listeners.values()) {
          server.setSecureContext({ key: state.keyPem, cert: state.certPem });
        }
      }
      const wanted = new Set(options.addresses());
      for (const [address, server] of listeners) {
        if (wanted.has(address)) continue;
        listeners.delete(address);
        yield* close(server);
      }
      for (const address of wanted) {
        if (listeners.has(address)) continue;
        let bound = yield* open(address, state.port);
        // The saved port is taken: move every address to a new one so they keep sharing it.
        if (Option.isNone(bound) && state.port !== 0 && listeners.size === 0) {
          bound = yield* open(address, 0);
        }
        if (Option.isSome(bound) && bound.value !== state.port) {
          state = { ...state, port: bound.value };
          yield* save(state);
        }
      }
      const fingerprint = certificateSha256(state.certPem);
      yield* publish(
        [...listeners.keys()].toSorted().map((address) => ({
          kind: "lan-tls" as const,
          httpBaseUrl: `https://${formatHostForUrl(address)}:${state.port}/`,
          certificateSha256: fingerprint,
        })),
      );
    });

    yield* sync.pipe(
      Effect.catchCause((cause) => Effect.logWarning("LAN fallback refresh failed", { cause })),
      Effect.repeat(Schedule.spaced(ADDRESS_POLL)),
    );
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) => Effect.logWarning("LAN fallback stopped", { cause })),
  );

  const active = yield* FiberHandle.make();
  const enabledNow = settings.getSettings.pipe(
    Effect.map((value) => value.cmdeck.lanFallback),
    Effect.orElseSucceed(() => false),
  );
  const changes = yield* settings.subscribeChanges;
  yield* Stream.concat(
    Stream.fromEffect(enabledNow),
    changes.pipe(Stream.map((value) => value.cmdeck.lanFallback)),
  ).pipe(
    Stream.changes,
    Stream.runForEach((enabled) =>
      enabled ? FiberHandle.run(active, serve, { onlyIfMissing: true }) : FiberHandle.clear(active),
    ),
    Effect.forkScoped,
  );

  return {
    endpoints: SubscriptionRef.get(endpoints),
    changes: SubscriptionRef.changes(endpoints).pipe(Stream.changes),
  } satisfies LanFallbackShape;
});

export const layerWith = (options: LanFallbackOptions) => Layer.effect(LanFallback, make(options));

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const platform = yield* HostProcess.Platform;
    return layerWith({
      addresses: () => lanAddresses(NodeOS.networkInterfaces(), platform),
      acceptsPeer: isLanAddress,
      primaryServer: () => adoptedServer,
    });
  }),
);

export type EndpointChanges = Stream.Stream<ReadonlyArray<ServerDirectEndpoint>>;

/**
 * DirectEndpoints plus the pinned LAN endpoints, and a stream of the full list whenever the LAN
 * ones change, so connected clients learn a new address or certificate without reconnecting.
 */
export const withLanFallback = (
  direct: DirectEndpoints.DirectEndpoints["Service"],
  lan: LanFallbackShape,
) => {
  const resolveAvailable = () =>
    Effect.zipWith(direct.resolveAvailable(), lan.endpoints, (base, pinned) => [
      ...base,
      ...pinned,
    ]);
  return {
    resolveAvailable,
    resolve: () =>
      Effect.zipWith(direct.resolve(), lan.endpoints, (base, pinned) => [...base, ...pinned]),
    changes: lan.changes.pipe(Stream.mapEffect(resolveAvailable)) satisfies EndpointChanges,
  };
};
