import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import type { OrchestrationProjectShell, OrchestrationV2AppThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { HttpClient } from "effect/http";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { layerOrchestratorMcpStubs } from "../checkScripts/checkScripts.testkit.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import { layerMemoryTest, threads } from "../memory/memory.testkit.ts";
import * as Knowledge from "./Knowledge.ts";

/**
 * Knowledge over a fresh in-memory database, with memory on and its embedder settings from
 * `settings`. Each project's folder is `<root>/<projectId>`; threads are memory.testkit's.
 */
export const layerKnowledgeTest = (options: {
  readonly root: string;
  readonly embedder?: HttpClient.HttpClient;
  readonly settings?: Parameters<typeof layerMemoryTest>[0]["settings"];
}) =>
  Knowledge.layerService.pipe(
    Layer.provideMerge(
      layerMemoryTest({
        memoryEnabled: true,
        ...(options.embedder === undefined ? {} : { embedder: options.embedder }),
        ...(options.settings === undefined ? {} : { settings: options.settings }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        getShell: (projectId) =>
          Effect.succeedSome({
            id: projectId,
            workspaceRoot: `${options.root}/${projectId}`,
          } as OrchestrationProjectShell),
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

/** The fork MCP tools on an in-process server, over `layerKnowledgeTest`. */
export const layerKnowledgeToolsTest = (options: Parameters<typeof layerKnowledgeTest>[0]) =>
  ForkMcpToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
    Layer.provideMerge(layerKnowledgeTest(options)),
    Layer.provide(layerOrchestratorMcpStubs()),
  );
