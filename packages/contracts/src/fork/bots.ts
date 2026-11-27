// Name rules ported from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// src/kiro_crew/members_parts/member_space.py validate_member_name (Apache-2.0). Changes: a Schema
// check instead of an exception, a 100-character cap, and no rule for URL path segments.
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { ModelSelection } from "../modelSelection.ts";
import { RuntimeMode } from "../providerPolicy.ts";
import { ScheduledTaskUpsertSchedule } from "../scheduledTask.ts";
import { MemoryScope } from "./memory.ts";

export const BOT_NAME_MAX_CHARS = 100;
/** Half the turn-context block, so a bot's instructions always fit beside its memory. */
export const BOT_INSTRUCTIONS_MAX_CHARS = 2_000;

/** Why a name is unusable, or undefined when it is fine. */
export const botNameProblem = (name: string): string | undefined => {
  if (name.length === 0) return "A bot needs a name.";
  if (name.length > BOT_NAME_MAX_CHARS) {
    return `A bot name can be at most ${BOT_NAME_MAX_CHARS} characters.`;
  }
  if (name !== name.trim()) return "A bot name cannot start or end with spaces.";
  if (/[\r\n\t]/u.test(name)) return "A bot name must be one line.";
  if (/[\p{Cc}\p{Cf}]/u.test(name) || name.normalize("NFC") !== name) {
    return "A bot name cannot contain hidden characters.";
  }
  return undefined;
};

export const BotName = Schema.String.check(
  Schema.makeFilter((name: string) => botNameProblem(name) ?? true),
);

export const BotInstructions = Schema.String.check(
  Schema.isMaxLength(BOT_INSTRUCTIONS_MAX_CHARS),
).annotate({
  description: `What the bot is for and how it works, added to every turn in its thread. Max ${BOT_INSTRUCTIONS_MAX_CHARS} characters.`,
});

export const BotStatus = Schema.Literals(["active", "deleted"]);
export type BotStatus = typeof BotStatus.Type;

/** A persistent agent: one pinned thread, its instructions and its private `bot:<id>` memory. */
export const BotProfile = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: BotName,
  instructions: Schema.String,
  projectId: ProjectId,
  threadId: ThreadId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  memoryScope: MemoryScope,
  /** Scheduled tasks that run in the bot's thread. */
  scheduledTaskIds: Schema.Array(ScheduledTaskId),
  /** Messaging channels the bot answers on; filled by the messaging adapters. */
  channelBindings: Schema.Array(Schema.String),
  status: BotStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BotProfile = typeof BotProfile.Type;

export const BotCreateInput = Schema.Struct({
  name: BotName,
  instructions: BotInstructions,
  projectId: ProjectId,
  /** Omitted: the project's default model. */
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotUpdateInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.optional(BotName),
  instructions: Schema.optional(BotInstructions),
});
export type BotUpdateInput = typeof BotUpdateInput.Type;

export const BotIdInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type BotIdInput = typeof BotIdInput.Type;

export const BotScheduleInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  schedule: ScheduledTaskUpsertSchedule,
});
export type BotScheduleInput = typeof BotScheduleInput.Type;

export const BotWakeResult = Schema.Struct({ threadId: ThreadId });
export type BotWakeResult = typeof BotWakeResult.Type;

export class BotsError extends Schema.TaggedError<BotsError>()("BotsError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
