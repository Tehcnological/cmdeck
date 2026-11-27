import {
  type BotCreateInput,
  type BotProfile,
  type BotScheduleInput,
  BotsError,
  type BotUpdateInput,
  type BotWakeResult,
  botNameProblem,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type MemoryScope,
  ModelSelection,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  type OrchestrationV2ServerCommand,
  ProjectId,
  RuntimeMode,
  type ScheduledTask,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as MemoryStore from "../memory/MemoryStore.ts";

/** Who asked: a person in a client, or an agent through MCP. */
export interface BotActor {
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

interface BotRow {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly modelSelectionJson: string;
  readonly runtimeMode: string;
  readonly channelBindingsJson: string;
  readonly status: "active" | "deleted";
  readonly deletedStateJson: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What deleting a bot paused and retired, so restoring it undoes exactly that. */
const DeletedState = Schema.Struct({
  taskIds: Schema.Array(Schema.String),
  memoryItemIds: Schema.Array(Schema.String),
});
const DeletedStateJson = Schema.fromJsonString(DeletedState);
const ModelSelectionJson = Schema.fromJsonString(ModelSelection);
const decodeDeletedState = Schema.decodeUnknownSync(DeletedStateJson);
const encodeDeletedState = Schema.encodeSync(DeletedStateJson);
const decodeModelSelection = Schema.decodeUnknownSync(ModelSelectionJson);
const encodeModelSelection = Schema.encodeSync(ModelSelectionJson);
const decodeRuntimeMode = Schema.decodeUnknownSync(RuntimeMode);
const decodeBindings = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const botMemoryScope = (botId: string): MemoryScope => `bot:${botId}`;

const toProfile = (row: BotRow, tasks: ReadonlyArray<ScheduledTask>): BotProfile => ({
  id: row.id,
  name: row.name,
  instructions: row.instructions,
  projectId: ProjectId.make(row.projectId),
  threadId: ThreadId.make(row.threadId),
  modelSelection: decodeModelSelection(row.modelSelectionJson),
  runtimeMode: decodeRuntimeMode(row.runtimeMode),
  memoryScope: botMemoryScope(row.id),
  scheduledTaskIds: tasks.filter((task) => task.threadId === row.threadId).map((task) => task.id),
  channelBindings: decodeBindings(row.channelBindingsJson),
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const fail = (reason: string) => Effect.fail(new BotsError({ reason }));
// MCP callers skip the contract schema, so the service checks names itself.
const checkName = (name: string) => {
  const problem = botNameProblem(name);
  return problem === undefined ? Effect.void : fail(problem);
};
const isBotsError = Schema.is(BotsError);

export class Bots extends Context.Service<
  Bots,
  {
    readonly list: Effect.Effect<ReadonlyArray<BotProfile>, BotsError>;
    /** Creates the bot's pinned thread in the project root, then its profile. */
    readonly create: (
      input: BotCreateInput,
      actor: BotActor,
    ) => Effect.Effect<BotProfile, BotsError>;
    readonly update: (input: BotUpdateInput) => Effect.Effect<BotProfile, BotsError>;
    /** Archives the thread, pauses its tasks and retires its memory. Reversed by `restore`. */
    readonly delete: (id: string) => Effect.Effect<BotProfile, BotsError>;
    readonly restore: (id: string) => Effect.Effect<BotProfile, BotsError>;
    /** Adds a scheduled task that continues the bot's own thread. */
    readonly schedule: (
      input: BotScheduleInput,
      actor: BotActor,
    ) => Effect.Effect<BotProfile, BotsError>;
    /** Runs the bot's first scheduled task now, in its thread. */
    readonly wake: (id: string) => Effect.Effect<BotWakeResult, BotsError>;
  }
>()("t3/fork/bots/Bots") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const memory = yield* MemoryStore.MemoryStore;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const failsTo =
    (action: string) =>
    <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.mapError((error) =>
          isBotsError(error)
            ? error
            : new BotsError({ reason: `Could not ${action}: ${error.message}` }),
        ),
      );

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const uuid = random.uuidV4().pipe(failsTo("name the bot"));

  const selectRows = sql.literal(`SELECT id, name, instructions, project_id AS "projectId",
    thread_id AS "threadId", model_selection_json AS "modelSelectionJson",
    runtime_mode AS "runtimeMode", channel_bindings_json AS "channelBindingsJson", status,
    deleted_state_json AS "deletedStateJson", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM bot_profiles`);

  const tasks = scheduledTasks.list().pipe(
    Effect.map((result) => result.tasks),
    failsTo("read the scheduled tasks"),
  );

  const requireRow = (id: string) =>
    sql<BotRow>`${selectRows} WHERE id = ${id}`.pipe(
      failsTo("read the bot"),
      Effect.flatMap((rows) =>
        rows[0] === undefined ? fail(`No bot ${id}.`) : Effect.succeed(rows[0]),
      ),
    );

  const profileOf = (id: string) =>
    Effect.all([requireRow(id), tasks]).pipe(Effect.map(([row, all]) => toProfile(row, all)));

  const commandId = (purpose: string) =>
    uuid.pipe(Effect.map((id) => CommandId.make(`bot:${purpose}:${id}`)));

  const dispatch = (command: OrchestrationV2ServerCommand, action: string) =>
    threads.dispatch(command).pipe(failsTo(action), Effect.asVoid);

  const defaultModel = Effect.fn("Bots.defaultModel")(function* (projectId: ProjectId) {
    const project = yield* projects.getShell(projectId).pipe(failsTo("read the project"));
    if (Option.isNone(project)) return yield* fail(`No project ${projectId}.`);
    const current = yield* settings.getSettings.pipe(failsTo("read the settings"));
    const selection = resolveProjectSettings(current, projectId, project.value).settings
      .defaultModelSelection;
    if (selection === null) {
      return yield* fail("This project has no default model. Choose a model for the bot.");
    }
    return selection;
  });

  const create: Bots["Service"]["create"] = Effect.fn("Bots.create")(function* (input, actor) {
    yield* checkName(input.name);
    const modelSelection = input.modelSelection ?? (yield* defaultModel(input.projectId));
    const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
    const id = yield* uuid;
    const threadId = ThreadId.make(yield* uuid);
    yield* dispatch(
      {
        type: "thread.create",
        commandId: yield* commandId("create"),
        threadId,
        projectId: input.projectId,
        title: input.name,
        modelSelection,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdBy: actor.createdBy,
        creationSource: actor.creationSource,
      },
      "create the bot's thread",
    );
    yield* dispatch(
      { type: "thread.pin", commandId: yield* commandId("pin"), threadId },
      "pin the bot's thread",
    );
    const at = yield* now;
    yield* sql`INSERT INTO bot_profiles (id, name, instructions, project_id, thread_id,
        model_selection_json, runtime_mode, status, created_at, updated_at)
      VALUES (${id}, ${input.name}, ${input.instructions.trim()}, ${input.projectId}, ${threadId},
        ${encodeModelSelection(modelSelection)}, ${runtimeMode}, 'active', ${at}, ${at})`.pipe(
      failsTo("save the bot"),
    );
    return yield* profileOf(id);
  });

  const requireActive = (id: string) =>
    requireRow(id).pipe(
      Effect.filterOrElse(
        (row) => row.status === "active",
        () => fail("This bot is deleted. Restore it first."),
      ),
    );

  const update: Bots["Service"]["update"] = Effect.fn("Bots.update")(function* (input) {
    const row = yield* requireActive(input.id);
    const name = input.name ?? row.name;
    yield* checkName(name);
    const instructions = input.instructions?.trim() ?? row.instructions;
    if (name !== row.name) {
      yield* dispatch(
        {
          type: "thread.metadata.update",
          commandId: yield* commandId("rename"),
          threadId: ThreadId.make(row.threadId),
          title: name,
        },
        "rename the bot's thread",
      );
    }
    yield* sql`UPDATE bot_profiles SET name = ${name}, instructions = ${instructions},
      updated_at = ${yield* now} WHERE id = ${row.id}`.pipe(failsTo("save the bot"));
    return yield* profileOf(row.id);
  });

  // The thread may already be archived or unarchived by hand; the bot changes state regardless.
  const setArchived = Effect.fn("Bots.setArchived")(
    function* (threadId: ThreadId, archived: boolean) {
      yield* threads.dispatch({
        type: archived ? "thread.archive" : "thread.unarchive",
        commandId: yield* commandId(archived ? "archive" : "unarchive"),
        threadId,
      });
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("The bot's thread did not change its archived state.", cause),
    ),
  );

  const remove: Bots["Service"]["delete"] = Effect.fn("Bots.delete")(function* (id) {
    const row = yield* requireRow(id);
    if (row.status === "deleted") return yield* profileOf(id);
    const running = (yield* tasks).filter((task) => task.threadId === row.threadId && task.enabled);
    for (const task of running) {
      yield* scheduledTasks
        .setEnabled({ id: task.id, enabled: false })
        .pipe(failsTo("pause the bot's schedule"));
    }
    const memoryItemIds = yield* memory
      .retireScope(botMemoryScope(id))
      .pipe(failsTo("retire the bot's memory"));
    yield* setArchived(ThreadId.make(row.threadId), true);
    const state = encodeDeletedState({ taskIds: running.map((task) => task.id), memoryItemIds });
    yield* sql`UPDATE bot_profiles SET status = 'deleted', deleted_state_json = ${state},
      updated_at = ${yield* now} WHERE id = ${id}`.pipe(failsTo("delete the bot"));
    return yield* profileOf(id);
  });

  const restore: Bots["Service"]["restore"] = Effect.fn("Bots.restore")(function* (id) {
    const row = yield* requireRow(id);
    if (row.status === "active") return yield* profileOf(id);
    const state =
      row.deletedStateJson === null
        ? { taskIds: [], memoryItemIds: [] }
        : decodeDeletedState(row.deletedStateJson);
    yield* setArchived(ThreadId.make(row.threadId), false);
    yield* memory.restoreRetired(state.memoryItemIds).pipe(failsTo("restore the bot's memory"));
    const existing = new Set((yield* tasks).map((task) => task.id));
    for (const taskId of state.taskIds) {
      if (!existing.has(ScheduledTaskId.make(taskId))) continue;
      yield* scheduledTasks
        .setEnabled({ id: ScheduledTaskId.make(taskId), enabled: true })
        .pipe(failsTo("resume the bot's schedule"));
    }
    yield* sql`UPDATE bot_profiles SET status = 'active', deleted_state_json = NULL,
      updated_at = ${yield* now} WHERE id = ${id}`.pipe(failsTo("restore the bot"));
    return yield* profileOf(id);
  });

  const schedule: Bots["Service"]["schedule"] = Effect.fn("Bots.schedule")(
    function* (input, actor) {
      const row = yield* requireActive(input.id);
      yield* scheduledTasks
        .upsert({
          title: row.name,
          prompt: input.prompt,
          enabled: true,
          schedule: input.schedule,
          projectId: ProjectId.make(row.projectId),
          threadId: ThreadId.make(row.threadId),
          threadMode: "continue",
          workspaceStrategy: { type: "root" },
          modelSelection: decodeModelSelection(row.modelSelectionJson),
          runtimeMode: decodeRuntimeMode(row.runtimeMode),
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdBy: actor.createdBy,
          creationSource: actor.creationSource,
        })
        .pipe(failsTo("schedule the bot"));
      return yield* profileOf(row.id);
    },
  );

  const wake: Bots["Service"]["wake"] = Effect.fn("Bots.wake")(function* (id) {
    const row = yield* requireActive(id);
    const task = (yield* tasks).find((candidate) => candidate.threadId === row.threadId);
    if (task === undefined) {
      return yield* fail("This bot has no schedule yet. Add one, then wake it.");
    }
    const result = yield* scheduledTasks.runNow({ id: task.id }).pipe(failsTo("wake the bot"));
    if (result.threadId === null) return yield* fail("The bot's scheduled task did not start.");
    return { threadId: result.threadId };
  });

  return Bots.of({
    list: Effect.all([
      sql<BotRow>`${selectRows} ORDER BY created_at ASC`.pipe(failsTo("list the bots")),
      tasks,
    ]).pipe(
      Effect.map(([rows, all]) => rows.map((row) => toProfile(row, all))),
      Effect.withSpan("Bots.list"),
    ),
    create,
    update,
    delete: remove,
    restore,
    schedule,
    wake,
  });
});

export const layer = Layer.effect(Bots, make);
