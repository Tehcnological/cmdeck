// Memory ownership cases adapted from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// test/test_member_memory_ownership.py (Apache-2.0), rewritten for bot:<id> memory scopes.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  type BotProfile,
  type OrchestrationV2ServerCommand,
  ProjectId,
  type ProviderInteractionMode,
  ProviderInstanceId,
  RunId,
  type RuntimeMode,
  type ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskError,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { McpServer } from "effect/ai";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import { liveThreadShell } from "../../mcp/McpToolAccess.testkit.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as MemoryStore from "../memory/MemoryStore.ts";
import { asAgentIn, layerMemoryTest, threads } from "../memory/memory.testkit.ts";
import * as TurnContext from "../memory/TurnContext.ts";
import * as ForkMcpToolkits from "../mcpToolkits.ts";
import { Bots, layer as botsLayer } from "./Bots.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-test" };
const projectId = ProjectId.make("project-app");
const asPerson = { createdBy: "user", creationSource: "web" } as const;

interface Modes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}
const FULL: Modes = { runtimeMode: "full-access", interactionMode: "default" };

/** Bots over the memory test world, with the thread commands and scheduled tasks it made. */
const makeWorld = Effect.gen(function* () {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
  const tasks = yield* Ref.make<ReadonlyArray<ScheduledTask>>([]);
  const ranNow = yield* Ref.make<ReadonlyArray<ScheduledTaskId>>([]);
  // Each thread's modes; an MCP caller's limits are its own thread's modes.
  const threadModes = yield* Ref.make<ReadonlyMap<string, Modes>>(new Map());

  const taskFrom = (input: ScheduledTaskUpsertInput, index: number): ScheduledTask => ({
    id: ScheduledTaskId.make(`task-${index}`),
    title: input.title,
    prompt: input.prompt,
    enabled: input.enabled,
    schedule: { type: "interval", everyMs: 3_600_000 },
    projectId: input.projectId,
    threadId: input.threadId ?? null,
    threadMode: input.threadMode ?? "new_thread",
    workspaceStrategy: input.workspaceStrategy,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    createdBy: input.createdBy ?? "user",
    creationSource: input.creationSource ?? "web",
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  });

  const requireTask = (id: ScheduledTaskId) =>
    Ref.get(tasks).pipe(
      Effect.flatMap((all) => {
        const task = all.find((candidate) => candidate.id === id);
        return task === undefined
          ? Effect.fail(new ScheduledTaskError({ message: "missing" }))
          : Effect.succeed(task);
      }),
    );

  const threadManagement = Layer.mock(ThreadManagementService.ThreadManagementService)({
    dispatch: (command) =>
      Ref.update(commands, (all) => [...all, command]).pipe(
        Effect.andThen(
          command.type === "thread.create"
            ? Ref.update(threadModes, (all) =>
                new Map(all).set(command.threadId, {
                  runtimeMode: command.runtimeMode,
                  interactionMode: command.interactionMode,
                }),
              )
            : Effect.void,
        ),
        Effect.as({ sequence: 1, storedEvents: [] }),
      ),
    getThreadShell: (threadId) =>
      Ref.get(threadModes).pipe(
        Effect.map((all) => liveThreadShell(threadId, all.get(threadId) ?? FULL)),
      ),
  });

  const layer = botsLayer.pipe(
    Layer.provideMerge(layerMemoryTest({ memoryEnabled: true })),
    Layer.provideMerge(threadManagement),
    Layer.provide(
      Layer.mock(ScheduledTaskService.ScheduledTaskService)({
        list: () => Ref.get(tasks).pipe(Effect.map((all) => ({ tasks: all }))),
        upsert: (input) =>
          Ref.modify(tasks, (all) => {
            const task = taskFrom(input, all.length + 1);
            return [{ task }, [...all, task]];
          }),
        setEnabled: (input) =>
          requireTask(input.id).pipe(
            Effect.map((task) => ({ ...task, enabled: input.enabled })),
            Effect.tap((task) =>
              Ref.update(tasks, (all) => all.map((other) => (other.id === task.id ? task : other))),
            ),
            Effect.map((task) => ({ task })),
          ),
        runNow: (input) =>
          requireTask(input.id).pipe(
            Effect.tap(() => Ref.update(ranNow, (all) => [...all, input.id])),
            Effect.map((task) => ({ task, threadId: task.threadId })),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        getShell: (id) =>
          Effect.succeedSome({
            id,
            title: "App",
            workspaceRoot: "/home/user/app",
            repositoryIdentity: null,
            defaultModelSelection: id === "project-bare" ? null : modelSelection,
            scripts: [],
            createdAt: "2026-11-27T00:00:00.000Z",
            updatedAt: "2026-11-27T00:00:00.000Z",
          }),
      }),
    ),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(ServerSettings.layerTest()),
  );
  const mcpLayer = ForkMcpToolkits.layer(McpHttpServer.toolkitRegistration).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provideMerge(layer),
  );
  return { commands, tasks, ranNow, threadModes, layer, mcpLayer };
});

/** Runs a test against a fresh world, with that world's records in reach. */
const inWorld = <A, E>(
  test: (
    world: Omit<Effect.Success<typeof makeWorld>, "layer" | "mcpLayer">,
  ) => Effect.Effect<A, E, Bots | MemoryStore.MemoryStore | TurnContext.TurnContext>,
) =>
  Effect.gen(function* () {
    const { layer, mcpLayer: _, ...world } = yield* makeWorld;
    return yield* test(world).pipe(Effect.provide(layer));
  });

/** The same, with the fork MCP tools served in process. */
const inMcpWorld = <A, E>(
  test: (
    world: Omit<Effect.Success<typeof makeWorld>, "layer" | "mcpLayer">,
  ) => Effect.Effect<A, E, Bots | McpServer.McpServer>,
) =>
  Effect.gen(function* () {
    const { layer: _, mcpLayer, ...world } = yield* makeWorld;
    return yield* test(world).pipe(Effect.provide(mcpLayer));
  });

/** Calls a bot tool as an agent in `threads.main`, whose modes are the caller's limits. */
const callTool = (name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    asAgentIn(threads.main.id),
  );

const setCallerModes = (threadModes: Ref.Ref<ReadonlyMap<string, Modes>>, modes: Modes) =>
  Ref.update(threadModes, (all) => new Map(all).set(threads.main.id, modes));

const createBot = (name = "Release Watcher", instructions = "Check for new releases.") =>
  Effect.gen(function* () {
    const bots = yield* Bots;
    return yield* bots.create({ name, instructions, projectId, modelSelection }, asPerson);
  });

const botThread = (bot: BotProfile) => ({ id: bot.threadId, projectId: bot.projectId });

describe("Bots", () => {
  it.effect("creating a bot makes one pinned thread and a bot memory scope", () =>
    inWorld(({ commands }) =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        const sent = yield* Ref.get(commands);
        expect(sent.map((command) => command.type)).toEqual(["thread.create", "thread.pin"]);
        const [create, pin] = sent;
        expect(create).toMatchObject({
          threadId: bot.threadId,
          projectId,
          title: "Release Watcher",
          worktreePath: null,
          createdBy: "user",
        });
        expect(pin).toMatchObject({ threadId: bot.threadId });
        expect(bot).toMatchObject({
          name: "Release Watcher",
          status: "active",
          memoryScope: `bot:${bot.id}`,
          scheduledTaskIds: [],
        });
        expect(yield* (yield* Bots).list).toEqual([bot]);
      }),
    ),
  );

  it.effect("a project with no default model asks for one", () =>
    inWorld(() =>
      Effect.gen(function* () {
        const error = yield* (yield* Bots)
          .create(
            { name: "Bot", instructions: "", projectId: ProjectId.make("project-bare") },
            asPerson,
          )
          .pipe(Effect.flip);
        expect(error.message).toContain("no default model");
      }),
    ),
  );

  it.effect("a bot's memory is visible in its own thread and nowhere else", () =>
    inWorld(() =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        const store = yield* MemoryStore.MemoryStore;
        const own = yield* store.threadContext(botThread(bot));
        expect(own.botId).toBe(bot.id);
        yield* store.remember({
          context: own,
          scope: bot.memoryScope,
          kind: "fact",
          content: "The last release checked was v4.2.0",
          actor: "user",
        });

        const found = yield* store.search({ context: own, query: "release", limit: 5 });
        expect(found.map((item) => item.content)).toEqual(["The last release checked was v4.2.0"]);

        // Same project, different thread: the bot's private memory does not exist for it.
        const other = yield* store.threadContext(threads.main);
        expect(yield* store.search({ context: other, query: "release", limit: 5 })).toEqual([]);
        const refused = yield* store
          .remember({
            context: other,
            scope: bot.memoryScope,
            kind: "fact",
            content: "Planted from elsewhere",
            actor: "user",
          })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(MemoryStore.MemoryAccessDeniedError);
      }),
    ),
  );

  it.effect(
    "instructions reach every turn in the bot's thread, ahead of memory, and no other",
    () =>
      inWorld(() =>
        Effect.gen(function* () {
          const bot = yield* createBot("Triage", "Label new issues.\n\nNever close an issue.");
          const store = yield* MemoryStore.MemoryStore;
          yield* store.remember({
            context: yield* store.threadContext(threads.main),
            scope: "project:project-app",
            kind: "rule",
            content: "Use pnpm, not npm",
            actor: "user",
          });
          const turnContext = yield* TurnContext.TurnContext;
          const turn = (thread: {
            readonly id: BotProfile["threadId"];
            readonly projectId: ProjectId;
          }) =>
            turnContext.contribute({
              thread,
              runId: RunId.make(`run-${thread.id}`),
              message: { text: "Anything new?", createdBy: "system" },
              inject: true,
            });

          const block = yield* turn(botThread(bot));
          expect(block).toContain('## Bot "Triage"');
          expect(block).toContain("- Label new issues.\n- Never close an issue.");
          expect(block.indexOf("Never close an issue.")).toBeLessThan(block.indexOf("Use pnpm"));

          const elsewhere = yield* turn(threads.main);
          expect(elsewhere).toContain("Use pnpm");
          expect(elsewhere).not.toContain("Label new issues");
        }),
      ),
  );

  it.effect("schedules continue the bot's own thread, and wake runs one now", () =>
    inWorld(({ tasks, ranNow }) =>
      Effect.gen(function* () {
        const bots = yield* Bots;
        const bot = yield* createBot();
        const scheduled = yield* bots.schedule(
          {
            id: bot.id,
            prompt: "Check for new releases.",
            schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/London" },
          },
          asPerson,
        );
        const [task] = yield* Ref.get(tasks);
        expect(task).toMatchObject({
          threadId: bot.threadId,
          threadMode: "continue",
          projectId,
          modelSelection,
        });
        expect(scheduled.scheduledTaskIds).toEqual([task?.id]);

        expect(yield* bots.wake(bot.id)).toEqual({ threadId: bot.threadId });
        expect(yield* Ref.get(ranNow)).toEqual([task?.id]);
      }),
    ),
  );

  it.effect("waking a bot with no schedule says what to do", () =>
    inWorld(() =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        const error = yield* (yield* Bots).wake(bot.id).pipe(Effect.flip);
        expect(error.message).toContain("no schedule");
      }),
    ),
  );

  it.effect("renaming a bot renames its thread", () =>
    inWorld(({ commands }) =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        const updated = yield* (yield* Bots).update({ id: bot.id, name: "Release Bot" });
        expect(updated.name).toBe("Release Bot");
        expect((yield* Ref.get(commands)).at(-1)).toMatchObject({
          type: "thread.metadata.update",
          threadId: bot.threadId,
          title: "Release Bot",
        });
      }),
    ),
  );

  it.effect("deleting archives, pauses and retires; restoring undoes exactly that", () =>
    inWorld(({ commands, tasks }) =>
      Effect.gen(function* () {
        const bots = yield* Bots;
        const store = yield* MemoryStore.MemoryStore;
        const bot = yield* createBot();
        yield* bots.schedule(
          { id: bot.id, prompt: "Check.", schedule: { type: "interval", everyMs: 3_600_000 } },
          asPerson,
        );
        const own = yield* store.threadContext(botThread(bot));
        const fact = yield* store.remember({
          context: own,
          scope: bot.memoryScope,
          kind: "fact",
          content: "Releases ship on Tuesdays",
          actor: "user",
        });
        const proposal = yield* store.remember({
          context: own,
          scope: bot.memoryScope,
          kind: "fact",
          content: "Releases might slip in December",
          actor: "agent",
        });

        const deleted = yield* bots.delete(bot.id);
        expect(deleted.status).toBe("deleted");
        expect((yield* Ref.get(commands)).at(-1)).toMatchObject({
          type: "thread.archive",
          threadId: bot.threadId,
        });
        expect((yield* Ref.get(tasks)).map((task) => task.enabled)).toEqual([false]);
        const statusOf = (id: string) =>
          store.get(id).pipe(Effect.map((item) => Option.getOrThrow(item).status));
        expect(yield* statusOf(fact.id)).toBe("retired");
        expect(yield* statusOf(proposal.id)).toBe("retired");
        // A deleted bot's thread is an ordinary thread again: no private memory, no instructions.
        expect((yield* store.threadContext(botThread(bot))).botId).toBeNull();
        expect((yield* bots.wake(bot.id).pipe(Effect.flip)).message).toContain("deleted");

        const restored = yield* bots.restore(bot.id);
        expect(restored.status).toBe("active");
        expect((yield* Ref.get(commands)).at(-1)).toMatchObject({
          type: "thread.unarchive",
          threadId: bot.threadId,
        });
        expect((yield* Ref.get(tasks)).map((task) => task.enabled)).toEqual([true]);
        expect(yield* statusOf(fact.id)).toBe("active");
        expect(yield* statusOf(proposal.id)).toBe("pending");
        expect((yield* store.threadContext(botThread(bot))).botId).toBe(bot.id);
      }),
    ),
  );

  it.effect("a new bot with a deleted bot's name starts empty", () =>
    inWorld(() =>
      Effect.gen(function* () {
        const bots = yield* Bots;
        const store = yield* MemoryStore.MemoryStore;
        const first = yield* createBot();
        yield* store.remember({
          context: yield* store.threadContext(botThread(first)),
          scope: first.memoryScope,
          kind: "fact",
          content: "Old release notes live in docs/old",
          actor: "user",
        });
        yield* bots.delete(first.id);

        const second = yield* createBot();
        expect(second.id).not.toBe(first.id);
        expect(second.threadId).not.toBe(first.threadId);
        const context = yield* store.threadContext(botThread(second));
        expect(yield* store.search({ context, query: "release notes", limit: 5 })).toEqual([]);
      }),
    ),
  );
  it.effect("a narrower caller cannot schedule or change a broader bot", () =>
    inMcpWorld(({ threadModes, tasks }) =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        yield* setCallerModes(threadModes, {
          runtimeMode: "approval-required",
          interactionMode: "default",
        });

        const scheduled = yield* callTool("bot_schedule", {
          id: bot.id,
          prompt: "Push the release.",
          schedule: { type: "interval", everyMs: 3_600_000 },
        });
        const updated = yield* callTool("bot_update", {
          id: bot.id,
          instructions: "Push to main.",
        });
        for (const result of [scheduled, updated]) {
          expect(result.isError).toBe(true);
          expect(JSON.stringify(result.content)).toContain("above this caller's");
        }
        expect(yield* Ref.get(tasks)).toEqual([]);
        const [after] = yield* (yield* Bots).list;
        expect(after?.instructions).toBe("Check for new releases.");
      }),
    ),
  );

  it.effect("a plan-mode caller makes a plan-mode bot, and equal limits may schedule it", () =>
    inMcpWorld(({ threadModes, commands, tasks }) =>
      Effect.gen(function* () {
        yield* setCallerModes(threadModes, { runtimeMode: "full-access", interactionMode: "plan" });
        const created = yield* callTool("bot_create", {
          name: "Planner",
          instructions: "Plan the release.",
          projectId: "project-app",
        });
        expect(created.isError).toBe(false);
        expect((yield* Ref.get(commands))[0]).toMatchObject({
          type: "thread.create",
          interactionMode: "plan",
        });
        const { id } = created.structuredContent as { id: string };
        const [bot] = yield* (yield* Bots).list;
        expect(bot?.interactionMode).toBe("plan");

        const scheduled = yield* callTool("bot_schedule", {
          id,
          prompt: "Plan the next release.",
          schedule: { type: "interval", everyMs: 3_600_000 },
        });
        expect(scheduled.isError).toBe(false);
        expect((yield* Ref.get(tasks))[0]?.interactionMode).toBe("plan");
      }),
    ),
  );

  it.effect("a caller with the bot's own limits may update it", () =>
    inMcpWorld(() =>
      Effect.gen(function* () {
        const bot = yield* createBot();
        const updated = yield* callTool("bot_update", { id: bot.id, instructions: "Watch tags." });
        expect(updated.isError).toBe(false);
        const [after] = yield* (yield* Bots).list;
        expect(after?.instructions).toBe("Watch tags.");
      }),
    ),
  );
});
