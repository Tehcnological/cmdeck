import {
  BOT_INSTRUCTIONS_MAX_CHARS,
  BOT_NAME_MAX_CHARS,
  type BotProfile,
  type BotsError,
  BotStatus,
  OrchestratorMcpFailure,
  ProjectId,
  ScheduledTaskUpsertSchedule,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { assertTargetWithinLimits } from "../../mcp/threadAccess.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { Bots, type BotActor } from "./Bots.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const BotEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: BotStatus,
  instructions: Schema.String,
  projectId: Schema.String,
  threadId: Schema.String,
  scheduledTaskIds: Schema.Array(Schema.String),
});

// Plain strings keep their descriptions in the JSON schema; the service checks names itself.
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max));
const BotIdParam = text(200).annotate({ description: "The bot's id from bot_list." });
const BotNameParam = text(BOT_NAME_MAX_CHARS).annotate({
  description: "Short display name, one line.",
});
const BotInstructionsParam = Schema.String.check(
  Schema.isMaxLength(BOT_INSTRUCTIONS_MAX_CHARS),
).annotate({
  description: "What the bot is for and how it works, added to every turn in its thread.",
});

/** Updates answer with this, not the whole profile, to keep the advertised tool list small. */
const BotChange = Schema.Struct({ id: Schema.String, status: BotStatus, message: Schema.String });

// The scheduler's own union carries webhook options a bot does not need; the handler decodes into it.
const ScheduleParam = Schema.Union([
  Schema.Struct({ type: Schema.Literal("interval"), everyMs: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("fixed_time"),
    timeOfDay: Schema.String,
    weekdays: Schema.optionalKey(Schema.Array(Schema.Number)),
  }),
  Schema.Struct({
    type: Schema.Literal("cron"),
    expression: Schema.String,
    timeZone: Schema.optionalKey(Schema.String),
  }),
]).annotate({
  description:
    "{type:'interval',everyMs} (min 60000), {type:'fixed_time',timeOfDay:'HH:MM',weekdays?} (0 is Sunday), or {type:'cron',expression,timeZone?}.",
});
const decodeSchedule = Schema.decodeUnknownExit(ScheduledTaskUpsertSchedule);

const BotListTool = Tool.make("bot_list", {
  ...shared,
  description: "List the user's bots: persistent agents with a pinned thread and private memory.",
  success: Schema.Struct({ bots: Schema.Array(BotEntry) }),
})
  .annotate(Tool.Title, "List bots")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BotCreateTool = Tool.make("bot_create", {
  ...shared,
  description:
    "Create a bot when the user asks for one: a persistent agent with its own pinned thread, instructions added to its every turn, and memory only it sees. Schedule it with bot_schedule. Plain recurring jobs use schedule_task.",
  parameters: Schema.Struct({
    name: BotNameParam,
    instructions: BotInstructionsParam,
    projectId: Schema.optionalKey(text(200)).annotate({
      description: "Project it works in. Default: this thread's project.",
    }),
  }),
  success: Schema.Struct({ id: Schema.String, threadId: Schema.String, message: Schema.String }),
})
  .annotate(Tool.Title, "Create a bot")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const BotUpdateTool = Tool.make("bot_update", {
  ...shared,
  description:
    "Change a bot's name or instructions, or delete (deleted=true) or restore (deleted=false) it. Delete archives its thread, pauses its schedules and retires its memory; restore undoes that.",
  parameters: Schema.Struct({
    id: BotIdParam,
    name: Schema.optionalKey(BotNameParam),
    instructions: Schema.optionalKey(BotInstructionsParam),
    deleted: Schema.optionalKey(Schema.Boolean),
  }),
  success: BotChange,
})
  .annotate(Tool.Title, "Update a bot")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BotScheduleTool = Tool.make("bot_schedule", {
  ...shared,
  description:
    "Add a schedule to a bot. Each run sends `prompt` to the bot's own thread, continuing its conversation.",
  parameters: Schema.Struct({
    id: BotIdParam,
    prompt: text(20_000).annotate({ description: "What the bot does on each run." }),
    schedule: ScheduleParam,
  }),
  success: BotChange,
})
  .annotate(Tool.Title, "Schedule a bot")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const toolkit = Toolkit.make(BotListTool, BotCreateTool, BotUpdateTool, BotScheduleTool);

const toEntry = (bot: BotProfile) => ({
  id: bot.id,
  name: bot.name,
  status: bot.status,
  instructions: bot.instructions,
  projectId: bot.projectId,
  threadId: bot.threadId,
  scheduledTaskIds: bot.scheduledTaskIds,
});

const change = (bot: BotProfile, message: string) => ({ id: bot.id, status: bot.status, message });

const failure = (error: BotsError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

const asAgent: BotActor = { createdBy: "agent", creationSource: "mcp" };

// Built with the server's context: a runtime without Bots (a tool-list test) refuses calls.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const bots = yield* Effect.serviceOption(Bots);
    const projections = yield* Effect.serviceOption(ProjectionStore.ProjectionStoreV2);
    const withBots = <A, R>(
      use: (service: Bots["Service"]) => Effect.Effect<A, BotsError | OrchestratorMcpFailure, R>,
    ): Effect.Effect<A, OrchestratorMcpFailure, R> =>
      Option.match(bots, {
        onNone: () =>
          Effect.fail(
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Bots are not available on this server.",
            }),
          ),
        onSome: (service) =>
          use(service).pipe(
            Effect.catchTags({ BotsError: (error) => Effect.fail(failure(error)) }),
          ),
      });

    const callerProject = Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "Creating a bot");
      const found = Option.isSome(projections)
        ? yield* projections.value
            .findThread(thread.thread.threadId)
            .pipe(Effect.orElseSucceed(() => null))
        : null;
      if (found === null) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass projectId: this thread's project could not be read.",
        });
      }
      return found.projectId;
    });

    // A bot's thread and schedules run unattended, so a caller may change one only when every
    // mode it runs at is within the caller's own limits, as for an ordinary scheduled task.
    const requireWithinLimits = (
      service: Bots["Service"],
      id: string,
      limits: McpToolAccess.StartedModes,
    ) =>
      service
        .runModes(id)
        .pipe(
          Effect.flatMap(({ threadId, modes }) =>
            Effect.forEach(modes, (mode) =>
              assertTargetWithinLimits(limits, { id: threadId, ...mode }),
            ),
          ),
        );
    const refused = { refused: "change bots in this environment" };

    return {
      bot_list: McpToolAccess.reads(() =>
        withBots((service) => service.list.pipe(Effect.map((all) => ({ bots: all.map(toEntry) })))),
      ),
      bot_create: McpToolAccess.startsThreads(
        () => ({}),
        ({ name, instructions, projectId }, modes) =>
          withBots((service) =>
            Effect.gen(function* () {
              const bot = yield* service.create(
                {
                  name,
                  instructions,
                  projectId:
                    projectId === undefined ? yield* callerProject : ProjectId.make(projectId),
                  runtimeMode: modes.runtimeMode,
                  interactionMode: modes.interactionMode,
                },
                asAgent,
              );
              return {
                id: bot.id,
                threadId: bot.threadId,
                message: "Created. Its thread is pinned in the sidebar.",
              };
            }),
          ),
        // A bot's later runs start long after its caller, with nothing to carry the link.
        { refused: "create bots in this environment" },
      ),
      bot_update: McpToolAccess.startsThreads(
        () => ({}),
        ({ id, name, instructions, deleted }, limits) =>
          withBots((service) =>
            Effect.gen(function* () {
              yield* requireWithinLimits(service, id, limits);
              if (deleted === true) {
                return change(yield* service.delete(id), "Deleted. The user can restore it.");
              }
              const restored = deleted === false ? yield* service.restore(id) : undefined;
              if (name !== undefined || instructions !== undefined) {
                const bot = yield* service.update({
                  id,
                  ...(name === undefined ? {} : { name }),
                  ...(instructions === undefined ? {} : { instructions }),
                });
                return change(bot, "Updated.");
              }
              if (restored !== undefined) return change(restored, "Restored.");
              return yield* new OrchestratorMcpFailure({
                code: "invalid_request",
                message: "Pass name, instructions or deleted.",
              });
            }),
          ),
        refused,
      ),
      bot_schedule: McpToolAccess.startsThreads(
        () => ({}),
        ({ id, prompt, schedule }, limits) =>
          withBots((service) =>
            Effect.gen(function* () {
              yield* requireWithinLimits(service, id, limits);
              if (prompt.trim() === "") {
                return yield* new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message: "Give the bot a prompt for each run.",
                });
              }
              const decoded = decodeSchedule(schedule);
              if (Exit.isFailure(decoded)) {
                return yield* new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message: `That schedule is not valid: ${Cause.pretty(decoded.cause)}`,
                });
              }
              const bot = yield* service.schedule(
                { id, prompt: prompt.trim(), schedule: decoded.value },
                asAgent,
              );
              return change(
                bot,
                `Scheduled. It now has ${bot.scheduledTaskIds.length} schedule(s).`,
              );
            }),
          ),
        refused,
      ),
    } satisfies McpToolAccess.Handlers<typeof toolkit.tools>;
  }),
);

export const register = (registration: typeof toolkitRegistration) => registration(toolkit, layer);
