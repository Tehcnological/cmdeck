import * as Layer from "effect/Layer";

import type { toolkitRegistration } from "../mcp/McpHttpServer.ts";
import * as Modules from "./mcpToolModules.ts";

/**
 * Fork MCP toolkits, merged into the server's advertised tools. Each module's `mcpTools.ts` (listed in
 * `mcpToolModules.ts`) exports its `toolkit` and a `register`. The registration helper is passed in
 * rather than imported, because McpHttpServer imports this file.
 */
export const layer = (register: typeof toolkitRegistration) =>
  Layer.mergeAll(Layer.empty, ...Object.values(Modules).map((module) => module.register(register)));
