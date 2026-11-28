import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  EnvironmentId,
  type OrchestrationV2AppThread,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import { layerOrchestratorMcpStubs } from "../checkScripts/checkScripts.testkit.ts";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as WorkLedger from "./WorkLedger.ts";

/** A conductor with two delegated workers, a top-level thread, and another conductor's worker. */
export const threads = {
  conductor: ThreadId.make("thread-conductor"),
  worker: ThreadId.make("thread-worker"),
  sibling: ThreadId.make("thread-sibling"),
  stranger: ThreadId.make("thread-stranger"),
  otherConductor: ThreadId.make("thread-other-conductor"),
  otherWorker: ThreadId.make("thread-other-worker"),
} as const;

const parents: Partial<Record<ThreadId, ThreadId>> = {
  [threads.worker]: threads.conductor,
  [threads.sibling]: threads.conductor,
  [threads.otherWorker]: threads.otherConductor,
};

const threadOf = (threadId: ThreadId) =>
  ({
    id: threadId,
    lineage: { parentThreadId: parents[threadId] ?? null },
  }) as unknown as OrchestrationV2AppThread;

/** WorkLedger over a fresh in-memory database with fork tables. */
export const layerWorkLedgerTest = WorkLedger.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      findThread: (threadId) => Effect.succeed(threadOf(threadId)),
    }),
  ),
  Layer.provide(NodeCrypto.layer),
);

/** The fork MCP tools on an in-process server, over `layerWorkLedgerTest`. */
export const layerWorkLedgerToolsTest = ForkMcpToolkits.layer(
  McpHttpServer.toolkitRegistration,
).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
  Layer.provideMerge(layerWorkLedgerTest),
  // The check-script toolkit in the same registry needs upstream's orchestrator services.
  Layer.provide(layerOrchestratorMcpStubs()),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "work-ledger-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "work-ledger-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

/** Runs an in-process MCP call as the agent of `threadId`; workers are delegated children. */
export const asAgentIn =
  (threadId: ThreadId) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-work-ledger-test"),
        requestNamespace: `provider-session-${threadId}`,
        thread: {
          threadId,
          providerSessionId: `provider-session-${threadId}`,
          providerInstanceId: ProviderInstanceId.make("codex"),
          ...(parents[threadId] === undefined ? {} : { subagent: true }),
        },
        client: undefined,
        capabilities: new Set<McpInvocationContext.McpCapability>(),
        issuedAt: 1,
      }),
      Effect.provideService(McpSchema.McpServerClient, client),
    );
