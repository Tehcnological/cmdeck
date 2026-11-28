import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  BotCreateInput,
  BotIdInput,
  BotProfile,
  BotScheduleInput,
  BotsError,
  BotUpdateInput,
  BotWakeResult,
} from "./bots.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  botsList: "cmdeck.bots.list",
  botsCreate: "cmdeck.bots.create",
  botsUpdate: "cmdeck.bots.update",
  botsDelete: "cmdeck.bots.delete",
  botsRestore: "cmdeck.bots.restore",
  botsSchedule: "cmdeck.bots.schedule",
  botsWake: "cmdeck.bots.wake",
} as const;

const BotsRpcError = Schema.Union([BotsError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.botsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(BotProfile),
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsCreate, {
    payload: BotCreateInput,
    success: BotProfile,
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsUpdate, {
    payload: BotUpdateInput,
    success: BotProfile,
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsDelete, {
    payload: BotIdInput,
    success: BotProfile,
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsRestore, {
    payload: BotIdInput,
    success: BotProfile,
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsSchedule, {
    payload: BotScheduleInput,
    success: BotProfile,
    error: BotsRpcError,
  }),
  Rpc.make(methods.botsWake, {
    payload: BotIdInput,
    success: BotWakeResult,
    error: BotsRpcError,
  }),
] as const;

export const readScopes = {
  [methods.botsList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // A bot is a thread plus scheduled tasks, so changing one needs what those commands need.
  [methods.botsCreate]: AuthOrchestrationOperateScope,
  [methods.botsUpdate]: AuthOrchestrationOperateScope,
  [methods.botsDelete]: AuthOrchestrationOperateScope,
  [methods.botsRestore]: AuthOrchestrationOperateScope,
  [methods.botsSchedule]: AuthOrchestrationOperateScope,
  [methods.botsWake]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
