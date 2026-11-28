import {
  MessageId,
  MessagePinRole,
  type MessagePinsError,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { MessagePins } from "./MessagePins.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const ThreadParam = Schema.optionalKey(Schema.String).annotate({
  description: "Thread whose pins these are. Default: this thread.",
});

const MessagePinListTool = Tool.make("message_pin_list", {
  ...shared,
  description:
    "List the messages pinned in a thread, oldest first, with a redacted preview of each.",
  parameters: Schema.Struct({ threadId: ThreadParam }),
  success: Schema.Struct({
    pins: Schema.Array(
      Schema.Struct({
        messageId: Schema.String,
        role: MessagePinRole,
        preview: Schema.String,
        pinnedAt: Schema.Number,
      }),
    ),
  }),
})
  .annotate(Tool.Title, "List pinned messages")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MessagePinTool = Tool.make("message_pin", {
  ...shared,
  description:
    "Pin (pinned=true) or unpin (pinned=false) a finished user or agent message so the user can jump back to it.",
  parameters: Schema.Struct({
    messageId: Schema.String.check(Schema.isMinLength(1)),
    pinned: Schema.Boolean,
    threadId: ThreadParam,
  }),
  success: Schema.Struct({ message: Schema.String }),
})
  .annotate(Tool.Title, "Pin a message")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const MessagePinsToolkit = Toolkit.make(MessagePinListTool, MessagePinTool);

const targetThread = (threadId: string | undefined) =>
  threadId === undefined
    ? McpInvocationContext.McpInvocationContext.pipe(
        Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "Pins")),
        Effect.map((scope) => scope.thread.threadId),
      )
    : Effect.succeed(ThreadId.make(threadId));

// Built with the server's context: a runtime without MessagePins (a tool-list test) refuses calls.
export const layer = McpToolAccess.toLayer(
  MessagePinsToolkit,
  Effect.gen(function* () {
    const pins = yield* Effect.serviceOption(MessagePins);
    const withPins = <A, R>(
      use: (
        service: MessagePins["Service"],
      ) => Effect.Effect<A, MessagePinsError | OrchestratorMcpFailure, R>,
    ): Effect.Effect<A, OrchestratorMcpFailure, R> =>
      Option.match(pins, {
        onNone: () =>
          Effect.fail(
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Pins are not available on this server.",
            }),
          ),
        onSome: (service) =>
          use(service).pipe(
            Effect.catchTags({
              MessagePinsError: (error) =>
                Effect.fail(
                  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
                ),
            }),
          ),
      });

    return {
      message_pin_list: McpToolAccess.reads(({ threadId }) =>
        withPins((service) =>
          targetThread(threadId).pipe(
            Effect.flatMap(service.list),
            Effect.map((all) =>
              all.map(({ messageId, role, preview, pinnedAt }) => ({
                messageId,
                role,
                preview,
                pinnedAt,
              })),
            ),
            Effect.map((list) => ({ pins: list })),
          ),
        ),
      ),
      // Another thread's pins change only within the caller's limits, like any write to it.
      message_pin: McpToolAccess.writesThreads(
        ({ threadId }) => [threadId === undefined ? undefined : ThreadId.make(threadId)],
        ({ threadId, messageId, pinned }) =>
          withPins((service) =>
            Effect.gen(function* () {
              const target = yield* targetThread(threadId);
              const input = { threadId: target, messageId: MessageId.make(messageId) };
              if (!pinned) {
                yield* service.unpin(input);
                return { message: "Unpinned." };
              }
              const pin = yield* service.pin(input);
              return { message: `Pinned: ${pin.preview}` };
            }),
          ),
      ),
    } satisfies McpToolAccess.Handlers<typeof MessagePinsToolkit.tools>;
  }),
);
