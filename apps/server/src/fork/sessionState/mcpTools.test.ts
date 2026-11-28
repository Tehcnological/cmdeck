import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as SessionState from "./SessionState.ts";
import { toolkit, layer as toolLayer } from "./mcpTools.ts";

const narrowCaller = ThreadId.make("thread:approval-required");
const broadThread = ThreadId.make("thread:full-access");
const missing = ThreadId.make("thread:missing");
const shellOf = (threadId: ThreadId) =>
  threadId === missing
    ? null
    : liveThreadShell(threadId, {
        runtimeMode: threadId === narrowCaller ? "approval-required" : "full-access",
      });

const layer = McpHttpServer.toolkitRegistration(toolkit, toolLayer).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(shellOf(threadId)),
      getThreadRecords: (threadId) =>
        Effect.succeed(idleThreadProjection(liveThreadShell(threadId))),
    }),
  ),
  Layer.provideMerge(SessionState.layer),
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "session-state-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "session-state-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const callAs = (caller: ThreadId, name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-session-state-test"),
      requestNamespace: "provider-session-session-state-test",
      thread: {
        threadId: caller,
        providerSessionId: "provider-session-session-state-test",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 1,
    }),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

it.layer(layer)((it) => {
  it.effect("an agent records, reads and clears its own thread's card", () =>
    Effect.gen(function* () {
      const recorded = yield* callAs(narrowCaller, "session_state_record", {
        goal: "Keep CI green",
        next: "Check the nightly run",
        triedApproach: "Retrying the job",
        triedRejectedBecause: "The flake is in the test",
      });
      expect(recorded.isError).toBeFalsy();
      expect(JSON.stringify(recorded.content)).toContain("next=Check the nightly run");

      const read = yield* callAs(narrowCaller, "session_state_read", {});
      expect(JSON.stringify(read.content)).toContain("Retrying the job");

      const empty = yield* callAs(narrowCaller, "session_state_record", {});
      expect(empty.isError).toBe(true);
      expect(JSON.stringify(empty.content)).toContain("Nothing to record");

      yield* callAs(narrowCaller, "session_state_record", { clear: true });
      const cleared = yield* callAs(narrowCaller, "session_state_read", {});
      expect(JSON.stringify(cleared.structuredContent)).toContain('"card":null');
    }),
  );

  it.effect("another thread's card changes only within the caller's limits", () =>
    Effect.gen(function* () {
      const state = yield* SessionState.SessionState;
      const refused = yield* callAs(narrowCaller, "session_state_record", {
        threadId: broadThread,
        goal: "Run anything",
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("runtime_mode_escalation_denied");
      expect(yield* state.get(broadThread)).toBeNull();

      const allowed = yield* callAs(broadThread, "session_state_record", {
        threadId: narrowCaller,
        goal: "Review the PR",
      });
      expect(allowed.isError).toBeFalsy();
      expect((yield* state.get(narrowCaller))?.goal).toBe("Review the PR");

      const nowhere = yield* callAs(broadThread, "session_state_record", {
        threadId: missing,
        goal: "Lost",
      });
      expect(nowhere.isError).toBe(true);
      expect(yield* state.get(missing)).toBeNull();
    }),
  );
});
