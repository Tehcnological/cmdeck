import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type MessagePin,
  MessagePinsError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import { idleThreadProjection, liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { MessagePins } from "./MessagePins.ts";
import { MessagePinsToolkit, layer as pinsToolLayer } from "./mcpTools.ts";

const narrowCaller = ThreadId.make("thread:approval-required");
const broadThread = ThreadId.make("thread:full-access");
const shellOf = (threadId: ThreadId) =>
  liveThreadShell(threadId, {
    runtimeMode: threadId === narrowCaller ? "approval-required" : "full-access",
  });

const calls: Array<string> = [];
const pinOf = (threadId: ThreadId, messageId: string): MessagePin =>
  ({ threadId, messageId, role: "assistant", preview: "The plan", pinnedAt: 1 }) as MessagePin;

const layer = McpHttpServer.toolkitRegistration(MessagePinsToolkit, pinsToolLayer).pipe(
  Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
  Layer.provide(
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) => Effect.succeed(shellOf(threadId)),
      getThreadRecords: (threadId) => Effect.succeed(idleThreadProjection(shellOf(threadId))),
    }),
  ),
  Layer.provide(
    Layer.succeed(MessagePins, {
      list: (threadId) => Effect.succeed([pinOf(threadId, "message-1")]),
      pin: (input) =>
        input.messageId === "streaming"
          ? Effect.fail(new MessagePinsError({ reason: "not-found" }))
          : Effect.sync(() => {
              calls.push(`pin ${input.threadId} ${input.messageId}`);
              return pinOf(input.threadId, input.messageId);
            }),
      unpin: (input) =>
        Effect.sync(() => {
          calls.push(`unpin ${input.threadId} ${input.messageId}`);
        }),
    }),
  ),
);

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "message-pins-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "message-pins-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const callAs = (caller: ThreadId, name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment-message-pins-test"),
      requestNamespace: "provider-session-message-pins-test",
      thread: {
        threadId: caller,
        providerSessionId: "provider-session-message-pins-test",
        providerInstanceId: ProviderInstanceId.make("codex"),
      },
      client: undefined,
      capabilities: new Set<McpInvocationContext.McpCapability>(["orchestration"]),
      issuedAt: 1,
    }),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

it.layer(layer)((it) => {
  it.effect("an agent pins, lists and unpins in its own thread", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const pinned = yield* callAs(narrowCaller, "message_pin", {
        messageId: "message-1",
        pinned: true,
      });
      expect(pinned.isError).toBeFalsy();
      const listed = yield* callAs(narrowCaller, "message_pin_list", {});
      expect(JSON.stringify(listed.content)).toContain("message-1");
      yield* callAs(narrowCaller, "message_pin", { messageId: "message-1", pinned: false });
      expect(calls).toEqual([`pin ${narrowCaller} message-1`, `unpin ${narrowCaller} message-1`]);

      const refused = yield* callAs(narrowCaller, "message_pin", {
        messageId: "streaming",
        pinned: true,
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("Only a finished message");
    }),
  );

  it.effect("another thread's pins change only within the caller's limits", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const refused = yield* callAs(narrowCaller, "message_pin", {
        threadId: broadThread,
        messageId: "message-1",
        pinned: true,
      });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("runtime_mode_escalation_denied");
      expect(calls).toEqual([]);

      const allowed = yield* callAs(broadThread, "message_pin", {
        threadId: narrowCaller,
        messageId: "message-1",
        pinned: true,
      });
      expect(allowed.isError).toBeFalsy();
      expect(calls).toEqual([`pin ${narrowCaller} message-1`]);
    }),
  );
});
