import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  MessageId,
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGenerators from "../../textGeneration/TextGenerators.ts";
import * as Decisions from "../decisions/Decisions.ts";
import { generators, LOCAL_GENERATOR } from "../decisions/decisions.testkit.ts";
import * as MemoryStore from "../memory/MemoryStore.ts";
import * as Lessons from "./Lessons.ts";

let sequence = 0;

/** A finished message in `thread-main`; `minute` orders it, overrides make it something else. */
export const message = (
  role: OrchestrationV2ConversationMessage["role"],
  text: string,
  minute: number,
  overrides: Partial<OrchestrationV2ConversationMessage> = {},
): OrchestrationV2ConversationMessage => {
  sequence += 1;
  const at = DateTime.makeUnsafe(Date.UTC(2026, 10, 28, 9, minute));
  return {
    id: MessageId.make(`message-${sequence}`),
    threadId: ThreadId.make("thread-main"),
    runId: RunId.make("run-1"),
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
    createdBy: role === "user" ? "user" : "agent",
    creationSource: role === "user" ? "web" : "provider",
    ...overrides,
  };
};

/** A command's output that reached the thread as a message: a notification nobody typed. */
export const toolOutput = (text: string, minute: number) =>
  message("user", text, minute, {
    createdBy: "system",
    creationSource: "server",
    notification: {
      source: { kind: "command" },
      outcome: "completed",
      summary: "npm test",
      detail: text,
    },
  } as Partial<OrchestrationV2ConversationMessage>);

/** Four turns where the user corrects the agent once. */
export const correctionChat = (start = 0) => [
  message("user", "Add a test for the parser.", start),
  message("assistant", "I ran npm test and added parser.test.ts.", start + 1),
  message("user", "No, this repo uses pnpm. Always use pnpm, never npm.", start + 2),
  message("assistant", "Understood, switched to pnpm test.", start + 3),
];

export const project = ProjectId.make("project-app");
export const thread = {
  id: ThreadId.make("thread-main"),
  projectId: project,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread-main" },
} as unknown as OrchestrationV2AppThread;

/**
 * A model that turns every sentence with "always" in the conversation into a lesson, so a line
 * that reaches it from a tool would come back as a lesson.
 */
const makeModel = () => {
  const prompts: Array<string> = [];
  /** Runs while the model is answering, to change settings or the thread meanwhile. */
  const during: { effect: Effect.Effect<void> } = { effect: Effect.void };
  const runner: TextGenerationOperations.Runner = (request) => {
    prompts.push(request.prompt);
    const conversation = /<conversation>\n([\s\S]*)\n<\/conversation>/u.exec(request.prompt)?.[1];
    const lessons = (conversation ?? "")
      .split(/[.\n]/u)
      .filter((sentence) => /\balways\b/iu.test(sentence))
      .map((sentence) => ({ lesson: sentence.trim() }));
    return during.effect.pipe(
      Effect.andThen(
        TextGenerationOperations.decodeJsonReply(request, "fake", JSON.stringify({ lessons })),
      ),
    );
  };
  return {
    prompts,
    during,
    layer: Layer.mock(TextGenerators.TextGenerators)({
      runner: (id) => Effect.succeed(id === LOCAL_GENERATOR ? runner : undefined),
    }),
  };
};

export const makeWorld = (options: {
  readonly memoryEnabled: boolean;
  readonly model: boolean;
  readonly hub?: Layer.Layer<MilestoneHub.MilestoneHub>;
}) => {
  const model = makeModel();
  const chat: { messages: Array<OrchestrationV2ConversationMessage> } = { messages: [] };
  const layer = Layer.effect(Lessons.Lessons, Lessons.make).pipe(
    Layer.provideMerge(Decisions.layer),
    Layer.provideMerge(MemoryStore.layer),
    Layer.provideMerge(options.hub ?? MilestoneHub.layer),
    Layer.provide(model.layer),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        findThread: (threadId) => Effect.succeed(threadId === thread.id ? thread : null),
        getMessageCount: () => Effect.sync(() => chat.messages.length),
        getThreadRecords: (() =>
          Effect.sync(() => ({
            thread,
            messages: chat.messages,
          }))) as unknown as ProjectionStore.ProjectionStoreV2["Service"]["getThreadRecords"],
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        getShell: (projectId) =>
          Effect.succeedSome({
            id: projectId,
            repositoryIdentity: null,
          } as OrchestrationProjectShell),
      }),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(
      ServerSettings.layerTest({
        textGenerators: generators,
        cmdeck: {
          memoryEnabled: options.memoryEnabled,
          decisionModel: options.model ? { instanceId: LOCAL_GENERATOR, model: "qwen3" } : null,
        },
      }),
    ),
    Layer.provide(NodeCrypto.layer),
  );
  return { model, chat, layer };
};
