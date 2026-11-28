// Tool wording adapted from Kiro Crew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// src/kiro_crew/mcp_tools/catalog/ledger.py (Apache-2.0). Changed: no artifacts, events or event
// kinds; a thread id for another thread within the caller's limits; clear.
import {
  OrchestratorMcpFailure,
  SESSION_STATE_PHASE_MAX,
  SESSION_STATE_TEXT_MAX,
  SessionStateTried,
  type SessionStateError,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import type { toolkitRegistration } from "../../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import { SessionState } from "./SessionState.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};

const ThreadParam = Schema.optionalKey(Schema.String).annotate({
  description: "Thread whose card this is. Default: this thread.",
});

const Text = (max: number, description: string) =>
  Schema.optionalKey(Schema.String.check(Schema.isMaxLength(max))).annotate({ description });

const Card = Schema.Struct({
  goal: Schema.String,
  phase: Schema.String,
  next: Schema.String,
  tried: Schema.Array(SessionStateTried),
  updatedAt: Schema.String,
});

const SessionStateReadTool = Tool.make("session_state_read", {
  ...shared,
  description:
    "Read this thread's session state card: goal, phase, next step and approaches already tried and rejected. It is saved outside the conversation, so it survives context compaction; trust it over your memory of earlier turns. Read it when resuming long-running work, before re-deriving state from the conversation.",
  parameters: Schema.Struct({ threadId: ThreadParam }),
  success: Schema.Struct({ card: Schema.NullOr(Card) }),
})
  .annotate(Tool.Title, "Read session state")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SessionStateRecordTool = Tool.make("session_state_record", {
  ...shared,
  description:
    "Save this thread's session state card so long-running work survives context compaction. CMDeck shows the card to the agent on scheduled, interval and webhook runs and on the first turn after a compaction. Write what a cold resume needs: next as a concrete step, not a status word, and approaches you tried and rejected. Fields you leave out keep their values. Phase done or abandoned stops the card being shown. Use it for multi-turn or unattended work, not for a single-turn request. clear=true deletes the card.",
  parameters: Schema.Struct({
    goal: Text(SESSION_STATE_TEXT_MAX, "The objective of this work."),
    phase: Text(
      SESSION_STATE_PHASE_MAX,
      "Current phase, free-form, such as implementing or awaiting-ci. done and abandoned end the work.",
    ),
    next: Text(SESSION_STATE_TEXT_MAX, "The concrete next step."),
    triedApproach: Text(
      SESSION_STATE_TEXT_MAX,
      "An approach you tried and rejected, appended so a later turn does not repeat it.",
    ),
    triedRejectedBecause: Text(SESSION_STATE_TEXT_MAX, "Why that approach was rejected."),
    clear: Schema.optionalKey(Schema.Boolean).annotate({
      description: "true deletes the card; other fields are then ignored.",
    }),
    threadId: ThreadParam,
  }),
  success: Schema.Struct({ message: Schema.String }),
})
  .annotate(Tool.Title, "Record session state")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const toolkit = Toolkit.make(SessionStateReadTool, SessionStateRecordTool);

const targetThread = Effect.fn("SessionState.targetThread")(function* (
  threadId: string | undefined,
) {
  if (threadId === undefined) {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    return (yield* McpInvocationContext.requireThreadScope(scope, "Session state")).thread.threadId;
  }
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const shell = yield* threads.getThreadShell(ThreadId.make(threadId)).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Threads unavailable.",
        }),
    ),
  );
  if (shell === null || shell.deletedAt !== null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: `Thread ${threadId} was not found.`,
    });
  }
  return shell.id;
});

// Built with the server's context: a runtime without SessionState (a tool-list test) refuses calls.
export const layer = McpToolAccess.toLayer(
  toolkit,
  Effect.gen(function* () {
    const state = yield* Effect.serviceOption(SessionState);
    const withState = <A, R>(
      use: (
        service: SessionState["Service"],
      ) => Effect.Effect<A, SessionStateError | OrchestratorMcpFailure, R>,
    ): Effect.Effect<A, OrchestratorMcpFailure, R> =>
      Option.match(state, {
        onNone: () =>
          Effect.fail(
            new OrchestratorMcpFailure({
              code: "capability_denied",
              message: "Session state is not available on this server.",
            }),
          ),
        onSome: (service) =>
          use(service).pipe(
            Effect.catchTags({
              SessionStateError: (error) =>
                Effect.fail(
                  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
                ),
            }),
          ),
      });

    return {
      session_state_read: McpToolAccess.reads(({ threadId }) =>
        withState((service) =>
          targetThread(threadId).pipe(
            Effect.flatMap(service.get),
            Effect.map((card) => ({
              card:
                card === null
                  ? null
                  : {
                      goal: card.goal,
                      phase: card.phase,
                      next: card.next,
                      tried: card.tried,
                      updatedAt: card.updatedAt,
                    },
            })),
          ),
        ),
      ),
      // The card reaches another thread's prompt, so writing it needs the caller's limits to cover it.
      session_state_record: McpToolAccess.writesThreads(
        ({ threadId }) => [threadId === undefined ? undefined : ThreadId.make(threadId)],
        ({ threadId, clear, ...patch }) =>
          withState((service) =>
            Effect.gen(function* () {
              const target = yield* targetThread(threadId);
              if (clear === true) {
                yield* service.clear(target);
                return { message: "Cleared." };
              }
              const card = yield* service.record(target, patch);
              return {
                message: `Recorded. phase=${card.phase || "(unset)"} next=${card.next || "(unset)"}`,
              };
            }),
          ),
      ),
    } satisfies McpToolAccess.Handlers<typeof toolkit.tools>;
  }),
);

export const register = (registration: typeof toolkitRegistration) => registration(toolkit, layer);
