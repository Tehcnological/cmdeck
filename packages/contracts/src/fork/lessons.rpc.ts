import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { AuthSettingsWriteScope, EnvironmentAuthorizationError } from "../auth.ts";
import { DecisionsError } from "./decisions.ts";
import { LessonsProjectInput } from "./lessons.ts";
import type { ForkRpcScopes } from "./rpc.ts";

// Which projects are opted in is read from `cmdeck.decisions.status` (consents for `lessons`).
export const methods = {
  lessonsSetProject: "cmdeck.lessons.setProject",
} as const;

export const rpcs = [
  Rpc.make(methods.lessonsSetProject, {
    payload: LessonsProjectInput,
    error: Schema.Union([DecisionsError, EnvironmentAuthorizationError]),
  }),
] as const;

export const readScopes = {} as const;

export const scopes = {
  // Opting in lets a project's chats reach a model API, so only a settings writer grants it.
  [methods.lessonsSetProject]: AuthSettingsWriteScope,
} as const satisfies ForkRpcScopes<typeof rpcs, typeof readScopes>;
