import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../config.ts";
import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { Snapshot } from "./Snapshot.ts";

const SnapshotExportTool = Tool.make("snapshot_export", {
  description:
    "Back up this environment's CMDeck data (threads, projects, memory, bots, settings) to a new folder on the server's machine. Secrets, sign-ins and worktrees are left out; credential-like text is redacted. Use only when the user asks for a backup or export. Restoring is not a tool: the user runs `cmdeck import snapshot --source <folder>` with CMDeck stopped.",
  success: Schema.Struct({
    path: Schema.String,
    schema: Schema.Number,
    notIncluded: Schema.Array(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Export a snapshot")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const toolkit = Toolkit.make(SnapshotExportTool);

// A snapshot holds every thread, so only a full-access caller may write one. Import replaces the
// whole database and needs the server stopped, so it stays a CLI command.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    // Optional so toolkits built without the server's services (tests, evals) still build.
    const snapshot = yield* Effect.serviceOption(Snapshot);
    const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
    return {
      snapshot_export: McpToolAccess.writesEnvironment(() =>
        Effect.gen(function* () {
          if (Option.isNone(snapshot) || Option.isNone(config)) {
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Snapshots are not available on this server.",
            });
          }
          const { path, manifest } = yield* snapshot.value
            .export({ stateDir: config.value.stateDir, out: undefined })
            .pipe(
              Effect.mapError(
                (error) =>
                  new OrchestratorMcpFailure({
                    code: "orchestration_error",
                    message: error.message,
                  }),
              ),
            );
          return { path, schema: manifest.schema, notIncluded: manifest.notIncluded };
        }),
      ),
    } satisfies McpToolAccess.Handlers<typeof toolkit.tools>;
  }),
);

export const register = (registration: typeof toolkitRegistration) => registration(toolkit, layer);
