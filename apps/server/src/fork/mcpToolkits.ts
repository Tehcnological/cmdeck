import * as Layer from "effect/Layer";

import type { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as MemoryTools from "./memory/mcpTools.ts";
import * as CheckScriptTools from "./checkScripts/mcpTools.ts";

/**
 * Fork MCP toolkits, merged into the server's advertised tools. The registration helper is passed
 * in rather than imported, because McpHttpServer imports this file.
 */
export const layer = (register: typeof toolkitRegistration) =>
  Layer.mergeAll(
    register(MemoryTools.MemoryToolkit, MemoryTools.layer),
    // The same instance upstream's orchestrator tools get: layers memoize by reference.
    register(CheckScriptTools.CheckScriptToolkit, CheckScriptTools.layer).pipe(
      Layer.provide(OrchestratorMcpService.layer),
    ),
  );
