import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema } from "effect/ai";
import { HttpClient } from "effect/http";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { layerOrchestratorMcpStubs } from "../checkScripts/checkScripts.testkit.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import * as MemoryEmbeddings from "./MemoryEmbeddings.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as TurnContext from "./TurnContext.ts";

const REPOSITORIES: Record<string, string> = {
  "project-app": "github.com/acme/app",
  // A second clone of the same repository, opened as its own project.
  "project-app-clone": "github.com/acme/app",
  "project-other": "github.com/acme/other",
};

const thread = (id: string, projectId: string, parentId: string | null = null) => ({
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
  lineage: {
    parentThreadId: parentId === null ? null : ThreadId.make(parentId),
    relationshipToParent: parentId === null ? null : ("fork" as const),
    rootThreadId: ThreadId.make(parentId ?? id),
  },
});

/**
 * Threads in the test world: two worktrees of one project, a clone, an unrelated project, and
 * a chain of forks (a fork of a fork) for memory-mode inheritance.
 */
export const threads = {
  main: thread("thread-main", "project-app"),
  worktree: thread("thread-worktree", "project-app"),
  clone: thread("thread-clone", "project-app-clone"),
  other: thread("thread-other", "project-other"),
  parent: thread("thread-parent", "project-app"),
  fork: thread("thread-fork", "project-app", "thread-parent"),
  forkOfFork: thread("thread-fork-of-fork", "project-app", "thread-fork"),
} as const;

const shell = (projectId: string): OrchestrationProjectShell => {
  const remoteUrl = REPOSITORIES[projectId];
  return {
    id: ProjectId.make(projectId),
    title: projectId,
    workspaceRoot: `/home/user/${projectId}`,
    repositoryIdentity:
      remoteUrl === undefined
        ? null
        : {
            canonicalKey: remoteUrl,
            locator: {
              source: "git-remote",
              remoteName: "origin",
              remoteUrl: `https://${remoteUrl}`,
            },
          },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-11-26T00:00:00.000Z",
    updatedAt: "2026-11-26T00:00:00.000Z",
  };
};

// Without an embedder chosen in settings, MemoryEmbeddings never reaches this.
const unreachable = HttpClient.make(() => Effect.die("memory tests make no request"));

/**
 * MemoryStore, MemoryEmbeddings and TurnContext over a fresh in-memory database with fork tables.
 * `embedder` answers embeddings requests; `settings` merge under the memory switch.
 */
export const layerMemoryTest = (options: {
  readonly memoryEnabled: boolean;
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly embedder?: HttpClient.HttpClient;
}) =>
  TurnContext.layer.pipe(
    Layer.provideMerge(MemoryStore.layer),
    Layer.provideMerge(
      MemoryEmbeddings.layer.pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, options.embedder ?? unreachable)),
        Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
      ),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(
      ServerSettings.layerTest({
        ...options.settings,
        cmdeck: { ...options.settings?.cmdeck, memoryEnabled: options.memoryEnabled },
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        getShell: (projectId) => Effect.succeedSome(shell(projectId)),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        findThread: (threadId) =>
          Effect.succeed(
            (Object.values(threads).find((thread) => thread.id === threadId) as
              | OrchestrationV2AppThread
              | undefined) ?? null,
          ),
      }),
    ),
    Layer.provide(NodeCrypto.layer),
  );

/** The fork MCP tools on an in-process server, over `layerMemoryTest`. */
export const layerMemoryToolsTest = (options: Parameters<typeof layerMemoryTest>[0]) =>
  ForkMcpToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
    Layer.provideMerge(layerMemoryTest(options)),
    Layer.provide(layerOrchestratorMcpStubs()),
  );

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "memory-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "memory-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

/** Runs an in-process MCP call as an agent working in `threadId`. */
export const asAgentIn =
  (threadId: ThreadId = threads.main.id) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-memory-test"),
        requestNamespace: "provider-session-memory-test",
        thread: {
          threadId,
          providerSessionId: "provider-session-memory-test",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set<McpInvocationContext.McpCapability>(),
        issuedAt: 1,
      }),
      Effect.provideService(McpSchema.McpServerClient, client),
    );
