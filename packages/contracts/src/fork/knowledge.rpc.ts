import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  KnowledgeAddSourceInput,
  KnowledgeError,
  KnowledgeListInput,
  KnowledgeSource,
  KnowledgeSourceInput,
} from "./knowledge.ts";
import type { ForkRpcScopes } from "./rpc.ts";

export const methods = {
  knowledgeList: "cmdeck.knowledge.list",
  knowledgeAddSource: "cmdeck.knowledge.addSource",
  knowledgeRemoveSource: "cmdeck.knowledge.removeSource",
  knowledgeReindex: "cmdeck.knowledge.reindex",
  knowledgeCancel: "cmdeck.knowledge.cancel",
} as const;

const KnowledgeFailure = Schema.Union([KnowledgeError, EnvironmentAuthorizationError]);

export const rpcs = [
  Rpc.make(methods.knowledgeList, {
    payload: KnowledgeListInput,
    success: Schema.Array(KnowledgeSource),
    error: KnowledgeFailure,
  }),
  Rpc.make(methods.knowledgeAddSource, {
    payload: KnowledgeAddSourceInput,
    success: KnowledgeSource,
    error: KnowledgeFailure,
  }),
  Rpc.make(methods.knowledgeRemoveSource, {
    payload: KnowledgeSourceInput,
    error: KnowledgeFailure,
  }),
  Rpc.make(methods.knowledgeReindex, {
    payload: KnowledgeSourceInput,
    success: KnowledgeSource,
    error: KnowledgeFailure,
  }),
  Rpc.make(methods.knowledgeCancel, {
    payload: KnowledgeSourceInput,
    success: KnowledgeSource,
    error: KnowledgeFailure,
  }),
] as const;

export const readScopes = {
  [methods.knowledgeList]: AuthOrchestrationReadScope,
} as const;

export const scopes = {
  // A source widens what the project's agents can read, so choosing one is a settings write.
  [methods.knowledgeAddSource]: AuthSettingsWriteScope,
  [methods.knowledgeRemoveSource]: AuthSettingsWriteScope,
  [methods.knowledgeReindex]: AuthOrchestrationOperateScope,
  [methods.knowledgeCancel]: AuthOrchestrationOperateScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
