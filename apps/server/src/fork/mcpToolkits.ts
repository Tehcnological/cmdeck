import * as Layer from "effect/Layer";

import type { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import * as MemoryTools from "./memory/mcpTools.ts";
import * as SandboxTools from "./sandbox/mcpTools.ts";

/**
 * Fork MCP toolkits, merged into the server's advertised tools. The registration helper is passed
 * in rather than imported, because McpHttpServer imports this file.
 */
export const layer = (register: typeof toolkitRegistration) =>
  Layer.mergeAll(
    register(MemoryTools.MemoryToolkit, MemoryTools.layer),
    register(SandboxTools.SandboxToolkit, SandboxTools.layer),
  );
