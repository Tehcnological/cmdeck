import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { ContainerSandbox } from "./ContainerSandbox.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const isMcpFailure = Schema.is(OrchestratorMcpFailure);

const SandboxStatusTool = Tool.make("sandbox_status", {
  ...shared,
  description:
    "Whether this thread's agent and terminals run in a container, and why the container cannot start when it cannot.",
  // No `parameters`: the default empty params serialize as a valid MCP object schema.
  success: Schema.Struct({
    sandboxed: Schema.Boolean,
    ready: Schema.Boolean,
    runtime: Schema.String,
    network: Schema.String,
    reason: Schema.NullOr(Schema.String),
  }),
})
  .annotate(Tool.Title, "Container status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const SandboxEnableTool = Tool.make("sandbox_enable", {
  ...shared,
  description:
    "Run this thread in a container from the next provider start. Use when the user asks to sandbox or isolate this thread. Only the user can turn a container off, or set one for a whole project.",
  success: Schema.Struct({ sandboxed: Schema.Boolean, message: Schema.String }),
})
  .annotate(Tool.Title, "Run in a container")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const SandboxToolkit = Toolkit.make(SandboxStatusTool, SandboxEnableTool);

const unavailable = new OrchestratorMcpFailure({
  code: "capability_denied",
  message: "Containers are not available on this server.",
});

// Agents may only tighten their own thread's boundary: no tool turns a container off, and none
// reaches other threads, whose modes may differ from the caller's (a project is the user's call).
export const layer = McpToolAccess.toLayer(
  SandboxToolkit,
  Effect.gen(function* () {
    const sandbox = yield* Effect.serviceOption(ContainerSandbox);
    const callerThread = Effect.gen(function* () {
      if (Option.isNone(sandbox)) return yield* unavailable;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "Containers");
      return { sandbox: sandbox.value, threadId: thread.thread.threadId };
    });
    const asFailure = Effect.mapError(
      (error: { readonly message: string } | OrchestratorMcpFailure) =>
        isMcpFailure(error)
          ? error
          : new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
    );

    return {
      sandbox_status: McpToolAccess.readsAsCaller(() =>
        Effect.gen(function* () {
          const { sandbox, threadId } = yield* callerThread;
          const status = yield* sandbox.status({ threadId });
          const runtime = status.runtimes.find((entry) => entry.kind === status.recipe.runtime);
          return {
            sandboxed: status.thread?.sandboxed ?? false,
            ready: status.ready,
            runtime: status.recipe.runtime,
            network: status.recipe.network,
            reason: status.ready
              ? null
              : status.recipe.image === ""
                ? "No container image is configured."
                : (runtime?.reason ?? null),
          };
        }).pipe(asFailure),
      ),
      sandbox_enable: McpToolAccess.actsAsCaller(() =>
        Effect.gen(function* () {
          const { sandbox, threadId } = yield* callerThread;
          const status = yield* sandbox.configure({ thread: { threadId, mode: "on" } }, "agent");
          return {
            sandboxed: true,
            message: status.ready
              ? "Done. The provider and new terminals start in a container from the next start."
              : "Saved, but the container cannot start yet: the user must finish the setup in Settings.",
          };
        }).pipe(asFailure),
      ),
    } satisfies McpToolAccess.Handlers<typeof SandboxToolkit.tools>;
  }),
);
