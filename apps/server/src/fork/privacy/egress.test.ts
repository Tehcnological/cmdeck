import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ClaudeSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { vi } from "vite-plus/test";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as PortScanner from "../../preview/PortScanner.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "../../provider/Drivers/ClaudeDriver.ts";
import * as ModelManifest from "../../provider/ModelManifest.ts";
import * as ProviderHostLive from "../../provider/ProviderHostLive.ts";
import * as ProviderInstallationGate from "../../provider/ProviderInstallationGate.ts";
import { makeProviderInstanceRegistry } from "../../provider/ProviderInstanceRegistry.ts";
import * as ProviderOrchestrationAdapterInfrastructure from "../../provider/ProviderOrchestrationAdapterInfrastructure.ts";
import * as ResetCreditCoordinator from "../../provider/resetCreditCoordinator.ts";
import * as ServerSettings from "../../serverSettings.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

// Mirrors "Network calls CMDeck makes" in docs/user/telemetry.md; change both together.
const ALLOWED_URL_PREFIXES = [
  "https://raw.githubusercontent.com/Tehcnological/cmdeck/",
  "https://registry.npmjs.org/",
  "https://raw.githubusercontent.com/BerriAI/litellm/",
  "https://api.github.com/repos/BerriAI/litellm/",
  "https://api.anthropic.com/api/oauth/usage",
  "https://github.com/Tehcnological/cmdeck/",
  "https://api.github.com/repos/Tehcnological/cmdeck/",
];
const isAllowed = (url: string) => ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const layerBackgroundPolicyAlwaysRun = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

// Every CLI call answers like an installed Claude Code, so no real binary runs.
const fakeClaudeCli = (commandLines: Array<string>) =>
  ChildProcessSpawner.make((command) => {
    if (ChildProcess.isStandardCommand(command))
      commandLines.push([command.command, ...command.args].join(" "));
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make("2.1.300 (Claude Code)\n")),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });

// Claude's npm installs look up new versions with `npm outdated`; Windows runs a quoted npm.cmd line.
const isNpm = (commandLine: string) => /(^|[\\/"])npm(\.cmd)?\^?"?(\s|$)/i.test(commandLine);

const layerServer = (
  settings: Parameters<typeof ServerSettings.layerTest>[0],
  requests: Array<string>,
) => {
  const recordingHttpClient = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request.url);
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json({ version: "2.1.300" })),
      );
    }),
  );
  const deps = ServerConfig.layerTest(process.cwd(), { prefix: "egress-privacy-test" }).pipe(
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
    Layer.provideMerge(Layer.mock(SecretResolver.SecretResolver)({})),
    Layer.provideMerge(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(
          EnvironmentId.make("00000000-0000-4000-8000-000000000001"),
        ),
      }),
    ),
    Layer.provideMerge(layerBackgroundPolicyAlwaysRun),
    Layer.provideMerge(recordingHttpClient),
    Layer.provideMerge(ServerSettings.layerTest(settings)),
    Layer.provideMerge(
      Layer.succeed(
        ProviderEventLoggers.ProviderEventLoggers,
        ProviderEventLoggers.NoOpProviderEventLoggers,
      ),
    ),
    Layer.provideMerge(ProviderLatestVersions.layer),
    Layer.provideMerge(McpProviderSessions.layer),
    Layer.provideMerge(ProviderInstallationGate.layer),
    Layer.provideMerge(ResetCreditCoordinator.layerTest),
  );
  return ProviderOrchestrationAdapterInfrastructure.layer.pipe(
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provideMerge(PortScanner.layerTest),
    Layer.provideMerge(ProviderHostLive.layer),
    // The real manifest service, so its fetch goes through the recording client.
    Layer.provideMerge(ModelManifest.layerModelCatalog),
    Layer.provideMerge(ModelManifest.layer),
    Layer.provideMerge(deps),
  );
};

/** Runs a signed-in Claude subscription instance through a status check and one periodic check. */
const runClaudeInstance = (input: {
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly claude: Partial<ClaudeSettings>;
  readonly environment?: ReadonlyArray<{ name: string; value: string; sensitive: boolean }>;
}) => {
  const requests: Array<string> = [];
  const commandLines: Array<string> = [];
  return Effect.gen(function* () {
    const fetchTrap = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
      requests.push(url instanceof Request ? url.url : String(url));
      return Promise.reject(new Error("egress test: unexpected fetch"));
    });
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
      () =>
        ({
          initializationResult: async () => ({
            commands: [{ name: "review", description: "", argumentHint: "" }],
            account: { email: "dev@example.com", subscriptionType: "pro", tokenSource: "oauth" },
          }),
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
            rate_limits_available: true,
            rate_limits: { five_hour: { utilization: 12, resets_at: "2099-01-01T00:00:00Z" } },
          }),
        }) as ReturnType<typeof ClaudeSdk.query>,
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        query.mockRestore();
        fetchTrap.mockRestore();
      }),
    );

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "egress-claude-" });
    // A file login is what lets the reset-credit check reach api.anthropic.com.
    yield* fileSystem.writeFileString(
      path.join(homePath, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } }),
    );

    // An npm install, so the update check asks the npm registry; the fake spawner runs it.
    const binaryPath = path.join(homePath, "lib/node_modules/@anthropic-ai/claude-code/cli.js");
    yield* fileSystem.makeDirectory(path.dirname(binaryPath), { recursive: true });
    yield* fileSystem.writeFileString(binaryPath, "");
    // The instance's own npm, so the lookup does not depend on the host having one.
    const npmDir = path.join(homePath, "npm-bin");
    yield* fileSystem.makeDirectory(npmDir);
    for (const name of ["npm", "npm.cmd"]) {
      yield* fileSystem.writeFileString(path.join(npmDir, name), "");
      yield* fileSystem.chmod(path.join(npmDir, name), 0o755);
    }

    const instanceId = ProviderInstanceId.make("claude_egress");
    const { registry } = yield* makeProviderInstanceRegistry<ClaudeDriverEnv>({
      drivers: [ClaudeDriver],
      configMap: {
        [instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          environment: [
            { name: "PATH", value: npmDir, sensitive: false },
            ...(input.environment ?? []),
          ],
          config: {
            ...ClaudeDriver.defaultConfig(),
            enabled: true,
            binaryPath,
            homePath,
            ...input.claude,
          },
        },
      },
    });
    const claude = (yield* registry.getInstance(instanceId))!;
    // Subscribe before each trigger; version enrichment publishes after the check returns.
    const nextEnrichedSnapshot = Stream.toPull(
      claude.snapshot.streamChanges.pipe(
        Stream.filter((snapshot: ServerProvider) => snapshot.versionAdvisory !== undefined),
      ),
    );

    const afterCheck = yield* nextEnrichedSnapshot;
    expect(yield* claude.snapshot.refresh).toMatchObject({ status: "ready" });
    yield* afterCheck;

    const afterPeriodicCheck = yield* nextEnrichedSnapshot;
    // One provider health interval, which also passes the failed manifest fetch's retry window.
    yield* TestClock.adjust("5 minutes");
    yield* afterPeriodicCheck;
    // Waits out a background manifest fetch; with update checks off it must not fetch either.
    yield* (yield* ModelManifest.ModelManifest).refresh;

    return { requests, npmLookups: commandLines.filter(isNpm).length };
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, fakeClaudeCli(commandLines)),
    Effect.scoped,
    Effect.provide(layerServer(input.settings, requests)),
  );
};

// macOS keeps the Claude login in the keychain, so the reset-credit request never forms there.
describe.skipIf(HostProcess.Platform.defaultValue() === "darwin")("server egress", () => {
  it.effect("a default Claude subscription instance calls only documented hosts", () =>
    Effect.gen(function* () {
      const { requests, npmLookups } = yield* runClaudeInstance({ settings: {}, claude: {} });
      expect(requests.filter((url) => !isAllowed(url))).toEqual([]);
      // Proves the harness reaches each gated call, so the switch-off tests are not vacuous.
      expect(requests).toEqual(
        expect.arrayContaining([
          "https://api.anthropic.com/api/oauth/usage",
          "https://raw.githubusercontent.com/Tehcnological/cmdeck/main/apps/server/src/provider/model-manifest.json",
        ]),
      );
      expect(npmLookups).toBeGreaterThan(0);
    }),
  );

  it.effect("a Bedrock instance leaves AWS to Claude Code and calls no AWS host itself", () =>
    Effect.gen(function* () {
      const { requests } = yield* runClaudeInstance({
        settings: {},
        claude: {},
        environment: [
          { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", sensitive: false },
          { name: "AWS_PROFILE", value: "bedrock-dev", sensitive: false },
          { name: "AWS_REGION", value: "us-west-2", sensitive: false },
        ],
      });
      expect(requests.filter((url) => !isAllowed(url))).toEqual([]);
    }),
  );

  it.effect("makes no request and no npm lookup once its privacy switches are off", () =>
    Effect.gen(function* () {
      const run = yield* runClaudeInstance({
        settings: { enableProviderUpdateChecks: false },
        claude: { resetCreditsCheck: false },
      });
      expect(run).toEqual({ requests: [], npmLookups: 0 });
    }),
  );

  it.effect("turning off reset credits alone stops the api.anthropic.com request", () =>
    Effect.gen(function* () {
      const { requests } = yield* runClaudeInstance({
        settings: {},
        claude: { resetCreditsCheck: false },
      });
      expect(requests.filter((url) => url.startsWith("https://api.anthropic.com/"))).toEqual([]);
      expect(requests.filter((url) => !isAllowed(url))).toEqual([]);
    }),
  );

  it.effect("turning off provider update checks alone stops the manifest and npm lookups", () =>
    Effect.gen(function* () {
      const { requests, npmLookups } = yield* runClaudeInstance({
        settings: { enableProviderUpdateChecks: false },
        claude: {},
      });
      expect(requests.filter((url) => !url.startsWith("https://api.anthropic.com/"))).toEqual([]);
      expect(npmLookups).toBe(0);
    }),
  );

  // usagePriceDownload: false is covered by "never downloads prices when usagePriceDownload is off"
  // in apps/server/src/usage/UsageService.test.ts.
});
