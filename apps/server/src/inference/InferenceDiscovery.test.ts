import { describe, expect, it } from "@effect/vitest";
import { InferenceServerId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as InferenceDiscovery from "./InferenceDiscovery.ts";

const rtx = InferenceServerId.make("rtx");
const spark1 = InferenceServerId.make("spark1");

// Listeners on 8030 (any address), 22 (below 1024), and 5432 (loopback).
const PROC_NET_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F5E 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5001 1 0000000000000000 100 0 0 10 0
   1: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 5002 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5003 1 0000000000000000 100 0 0 10 0
`;

// macOS `lsof -iTCP -sTCP:LISTEN -P -n -F n`: listeners on 1337 (any address), 8321 (loopback),
// 22 (below 1024), 8793 (IPv6 loopback), and 5000 (AirPlay, which refuses with an empty 403),
// plus 9999 bound to a LAN address only.
const LSOF_LISTENERS = `p500
f5
n*:5000
p501
f7
n*:1337
p502
f9
n127.0.0.1:8321
p503
f3
n*:22
p504
f11
n[::1]:8793
p505
f12
n192.168.1.20:9999
`;

const glm = {
  object: "list",
  data: [{ id: "GLM-5.3-Flash", owned_by: "tensorfold", context_length: 702464 }],
};

function discover(
  input: Parameters<InferenceDiscovery.InferenceDiscovery["Service"]["discover"]>[0],
  routes: Readonly<Record<string, unknown>>,
  inferenceServers: Record<string, { baseUrl: string; apiKey: string; enabled: boolean }>,
  host: { readonly platform?: NodeJS.Platform; readonly lsof?: string | null } = {},
) {
  const seen: Array<{ url: string; auth: string | undefined }> = [];
  const commands: Array<string> = [];
  const processRunner = Layer.succeed(
    ProcessRunner.ProcessRunner,
    ProcessRunner.ProcessRunner.of({
      run: (input) =>
        Effect.suspend(() => {
          commands.push([input.command, ...input.args].join(" "));
          if (host.lsof === undefined || host.lsof === null) {
            return Effect.fail(
              new ProcessRunner.ProcessSpawnError({
                command: input.command,
                argumentCount: input.args.length,
                cause: new Error("spawn lsof ENOENT"),
              }),
            );
          }
          return Effect.succeed({
            stdout: host.lsof,
            stderr: "",
            code: null,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          });
        }),
    }),
  );
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.suspend(() => {
        seen.push({ url: request.url, auth: request.headers["authorization"] });
        const route = routes[request.url];
        if (route === undefined) {
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: new TypeError("fetch failed"),
              }),
            }),
          );
        }
        const response =
          typeof route === "number"
            ? new Response("", { status: route })
            : Response.json(route, { status: 200 });
        return Effect.succeed(HttpClientResponse.fromWeb(request, response));
      }),
    ),
  );
  const missing = FileSystem.makeNoop({});
  return Effect.gen(function* () {
    const discovery = yield* InferenceDiscovery.make;
    const result = yield* discovery.discover(input);
    return { result, seen, commands };
  }).pipe(
    Effect.provideService(HostProcess.Platform, host.platform ?? "linux"),
    Effect.provide([
      ServerSettings.layerTest({ inferenceServers }),
      FileSystem.layerNoop({
        readFileString: (path) =>
          path === "/proc/net/tcp" && host.platform === undefined
            ? Effect.succeed(PROC_NET_TCP)
            : missing.readFileString(path),
      }),
      http,
      processRunner,
    ]),
  );
}

describe("InferenceDiscovery", () => {
  it.effect("finds a server that moved to an unlisted port, without sending the saved key", () =>
    Effect.gen(function* () {
      const { result, seen } = yield* discover(
        {},
        {
          "http://localhost:8030/v1/models": glm,
          "http://localhost:8030/v1/chat/completions": 400,
          "http://localhost:8030/v1/responses": 404,
        },
        { [rtx]: { baseUrl: "http://localhost:8888/v1", apiKey: "secret", enabled: true } },
      );
      expect(result).toEqual({
        servers: [
          {
            baseUrl: "http://localhost:8030/v1",
            status: "ready",
            engine: "TensorFold",
            models: [{ id: "GLM-5.3-Flash", servedContextWindow: 702464 }],
            apiProtocols: ["chat-completions"],
          },
        ],
        searchedListeningPorts: true,
      });
      expect(seen.some((request) => request.url.includes(":22/"))).toBe(false);
      expect(seen.some((request) => request.url === "http://localhost:5432/v1/models")).toBe(true);
      expect(seen.every((request) => request.auth === undefined)).toBe(true);
    }),
  );

  it.effect("reads listeners from lsof on macOS, which has no /proc", () =>
    Effect.gen(function* () {
      const { result, seen, commands } = yield* discover(
        {},
        {
          "http://localhost:1337/v1/models": glm,
          "http://localhost:1337/v1/chat/completions": 400,
          "http://localhost:1337/v1/responses": 404,
          "http://localhost:5000/v1/models": 403,
        },
        {},
        { platform: "darwin", lsof: LSOF_LISTENERS },
      );
      expect(commands).toEqual(["lsof -iTCP -sTCP:LISTEN -P -n -F n"]);
      expect(result).toEqual({
        servers: [
          {
            baseUrl: "http://localhost:1337/v1",
            status: "ready",
            engine: "TensorFold",
            models: [{ id: "GLM-5.3-Flash", servedContextWindow: 702464 }],
            apiProtocols: ["chat-completions"],
          },
        ],
        searchedListeningPorts: true,
      });
      const probed = (port: number) =>
        seen.some((request) => request.url === `http://localhost:${port}/v1/models`);
      expect(probed(5000)).toBe(true);
      expect(probed(8321)).toBe(true);
      expect(probed(8793)).toBe(true);
      expect(probed(22)).toBe(false);
      expect(probed(9999)).toBe(false);
    }),
  );

  it.effect("falls back to the well-known ports when lsof is missing", () =>
    Effect.gen(function* () {
      const { result, seen } = yield* discover(
        {},
        { "http://localhost:11434/v1/models": 401 },
        {},
        { platform: "darwin", lsof: null },
      );
      expect(result).toEqual({
        servers: [{ baseUrl: "http://localhost:11434/v1", status: "needs-key", models: [] }],
        searchedListeningPorts: false,
      });
      expect(seen.map((request) => request.url).toSorted()).toEqual(
        InferenceDiscovery.WELL_KNOWN_PORTS.map(
          (port) => `http://localhost:${port}/v1/models`,
        ).toSorted(),
      );
    }),
  );

  it.effect("does not run lsof where /proc lists the listeners", () =>
    Effect.gen(function* () {
      const { commands } = yield* discover({}, {}, {}, { lsof: LSOF_LISTENERS });
      expect(commands).toEqual([]);
    }),
  );

  it.effect("reports a server that wants a key, and marks one already registered", () =>
    Effect.gen(function* () {
      const { result } = yield* discover(
        {},
        {
          "http://localhost:11434/v1/models": 401,
          "http://127.0.0.1:1234/v1/models": glm,
        },
        { [rtx]: { baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", enabled: true } },
      );
      expect(
        result.servers.map(({ baseUrl, status, registeredServerId }) => ({
          baseUrl,
          status,
          registeredServerId,
        })),
      ).toEqual([
        { baseUrl: "http://127.0.0.1:1234/v1", status: "ready", registeredServerId: rtx },
        {
          baseUrl: "http://localhost:11434/v1",
          status: "needs-key",
          registeredServerId: undefined,
        },
      ]);
    }),
  );
});

describe("discoveryCandidates", () => {
  const registered = [
    [rtx, "http://rtx:8888/v1"],
    [spark1, "http://spark1:8888/v1"],
  ] as const;

  it("searches a remote host by its saved and well-known ports only", () => {
    expect(
      InferenceDiscovery.discoveryCandidates({
        host: "spark1",
        registered,
        listeningPorts: [8030],
        hostname: "rtx",
      }).map((candidate) => candidate.base),
    ).toEqual([
      "http://spark1:8888/v1",
      ...InferenceDiscovery.WELL_KNOWN_PORTS.map((port) => `http://spark1:${port}/v1`),
    ]);
  });

  it("treats every name of this machine as one, keeping the name a repair used", () => {
    const bases = InferenceDiscovery.discoveryCandidates({
      host: "rtx",
      registered,
      listeningPorts: [8030],
      hostname: "rtx",
    });
    expect(bases).toContainEqual({ base: "http://rtx:8888/v1", registeredServerId: rtx });
    expect(bases).toContainEqual({ base: "http://rtx:8030/v1", fromListener: true });
    expect(bases.some((candidate) => candidate.base.includes("spark1"))).toBe(false);
  });

  it("brackets an IPv6 host and probes nothing for a host that is not one", () => {
    const search = (host: string) =>
      InferenceDiscovery.discoveryCandidates({
        host,
        registered: [],
        listeningPorts: [],
        hostname: "rtx",
      }).map((candidate) => candidate.base);
    expect(search("fd00::5")).toEqual(
      InferenceDiscovery.WELL_KNOWN_PORTS.map((port) => `http://[fd00::5]:${port}/v1`),
    );
    for (const host of ["evil.example/x?", "user@evil.example", "evil.example#", "a:1"]) {
      expect(search(host)).toEqual([]);
    }
  });
});
