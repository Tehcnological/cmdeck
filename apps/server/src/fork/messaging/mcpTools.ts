import { type MessagingError, OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { MessagingService } from "./MessagingService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

const ChatEntry = Schema.Struct({
  channelId: Schema.String,
  channelName: Schema.String,
  chatId: Schema.String,
  label: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  threadTitle: Schema.NullOr(Schema.String),
});

const MessagingChatsTool = Tool.make("messaging_chats", {
  ...shared,
  description:
    "List the user's chat-app conversations (Telegram) and the thread each one drives. A chat appears once its allowed sender has messaged the bot.",
  success: Schema.Struct({ chats: Schema.Array(ChatEntry) }),
})
  .annotate(Tool.Title, "List messaging chats")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MessagingBindTool = Tool.make("messaging_bind", {
  ...shared,
  description:
    "When the user asks, bind a chat from messaging_chats to a thread so their messages there become turns on it and its approvals reach them, or unbind it (unbind=true).",
  parameters: Schema.Struct({
    channelId: Id.annotate({ description: "The chat's channelId from messaging_chats." }),
    chatId: Id.annotate({ description: "The chat's chatId from messaging_chats." }),
    threadId: Schema.optionalKey(Id).annotate({
      description: "Thread to bind. Default: this thread.",
    }),
    unbind: Schema.optionalKey(Schema.Boolean),
  }),
  success: Schema.Struct({ message: Schema.String }),
})
  .annotate(Tool.Title, "Bind a messaging chat")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const toolkit = Toolkit.make(MessagingChatsTool, MessagingBindTool);

const failure = (error: MessagingError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

// Built with the server's context: a runtime without messaging (a tool-list test) refuses calls.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const messaging = yield* Effect.serviceOption(MessagingService);
    const withMessaging = <A, R>(
      use: (
        service: MessagingService["Service"],
      ) => Effect.Effect<A, MessagingError | OrchestratorMcpFailure, R>,
    ): Effect.Effect<A, OrchestratorMcpFailure, R> =>
      Option.match(messaging, {
        onNone: () =>
          Effect.fail(
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Messaging is not available on this server.",
            }),
          ),
        onSome: (service) =>
          use(service).pipe(
            Effect.catchTags({ MessagingError: (error) => Effect.fail(failure(error)) }),
          ),
      });

    const callerThread = Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "Binding a chat");
      return thread.thread.threadId;
    });

    return {
      messaging_chats: McpToolAccess.reads(() =>
        withMessaging((service) => service.listChats.pipe(Effect.map((chats) => ({ chats })))),
      ),
      messaging_bind: McpToolAccess.either(
        (input) => input.unbind === true,
        McpToolAccess.writes(({ channelId, chatId }) =>
          withMessaging((service) =>
            service.unbind({ channelId, chatId }).pipe(Effect.as({ message: "Unbound." })),
          ),
        ),
        // The chat's sender then drives the thread at its own modes, so a caller may bind only a
        // thread within its own limits; writesThreads checks a thread other than the caller's.
        McpToolAccess.writesThreads(
          (input) => [input.threadId === undefined ? undefined : ThreadId.make(input.threadId)],
          ({ channelId, chatId, threadId }) =>
            withMessaging((service) =>
              Effect.gen(function* () {
                yield* service.bind({
                  channelId,
                  chatId,
                  threadId: threadId ?? (yield* callerThread),
                });
                return { message: "Bound. Messages in that chat now start turns on the thread." };
              }),
            ),
        ),
      ),
    } satisfies McpToolAccess.Handlers<typeof toolkit.tools>;
  }),
);

export const register = (registration: typeof toolkitRegistration) => registration(toolkit, layer);
