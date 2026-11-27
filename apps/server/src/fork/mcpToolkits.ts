import * as Layer from "effect/Layer";

import type { toolkitRegistration } from "../mcp/McpHttpServer.ts";

/**
 * Fork MCP toolkits, merged into the server's advertised tools. The registration helper is passed
 * in rather than imported, because McpHttpServer imports this file.
 */
export const layer = (_register: typeof toolkitRegistration) => Layer.empty;
