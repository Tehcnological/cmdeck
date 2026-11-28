// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/history_consolidation.py
// (message threshold and idle wait; Apache-2.0). Changes: one pass per thread, not per transcript file.
import {
  type DecisionsError,
  type LessonsProjectInput,
  type MemoryScope,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import type * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as TextGenerators from "../../textGeneration/TextGenerators.ts";
import { Decisions } from "../decisions/Decisions.ts";
import * as MemoryAccess from "../memory/MemoryAccess.ts";
import { MemoryStore } from "../memory/MemoryStore.ts";
import { consolidationInput } from "./input.ts";
import { buildConsolidationPrompt, LessonsReply, normalized, proposedLessons } from "./prompt.ts";

// Kiro Crew's `_CONSOLIDATION_THRESHOLD` and `history_idle_secs`.
/** New messages in a thread that start a pass at once. */
export const MESSAGE_THRESHOLD = 30;
/** How long a thread rests after its last turn before a pass reads what is new. */
export const IDLE: Duration.Input = "3 hours";
/** Fewer new prose messages than this teach too little to spend a model call on. */
export const MIN_MESSAGES = 4;
const MODEL_TIMEOUT: Duration.Input = "2 minutes";

// The runner reports this name in errors; lessons are not one of upstream's text operations.
const LESSONS_OPERATION = "lessons" as TextGenerationOperations.Operation;

/**
 * Lessons (WI-2.07): an opted-in project's chats are read now and then by the decision model,
 * and what the user taught becomes pending project facts. Nothing is used until a person accepts
 * it in Settings > Memory, where it can also be made a rule.
 */
export class Lessons extends Context.Service<
  Lessons,
  {
    /** Opts a project in (a `lessons` consent) or out, and starts or stops the worker to match. */
    readonly setProject: (input: LessonsProjectInput) => Effect.Effect<void, DecisionsError>;
    /** One pass over the thread's new prose; how many lessons it proposed. Never fails. */
    readonly consolidate: (threadId: ThreadId) => Effect.Effect<number>;
  }
>()("t3/fork/lessons/Lessons") {}

/** @public Tests build it over their own projection store. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const decisions = yield* Decisions;
  const memory = yield* MemoryStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const textGenerators = yield* TextGenerators.TextGenerators;
  const hub = yield* MilestoneHub.MilestoneHub;
  // One pass at a time, as Kiro's consolidation gate: a pass is a model call and several writes.
  const gate = yield* Semaphore.make(1);
  const transitions = yield* Semaphore.make(1);
  const active = yield* FiberHandle.make<void, never>();

  const progress = (threadId: ThreadId) =>
    sql<{
      readonly through: string | null;
      readonly messageCount: number;
    }>`SELECT through, message_count AS "messageCount" FROM lesson_threads
      WHERE thread_id = ${threadId}`.pipe(Effect.map((rows) => rows[0]));

  const pass = Effect.fn("Lessons.pass")(function* (threadId: ThreadId) {
    if (!(yield* memory.enabled)) return 0;
    const thread = yield* projections.findThread(threadId);
    if (thread === null) return 0;
    // No model, no consent for this project, or a remote model under a local consent: no call.
    const choice = yield* decisions.modelFor("lessons", thread.projectId);
    if (choice.source === "rules") return 0;
    const context = yield* memory.threadContext({ id: thread.id, projectId: thread.projectId });
    const scope: MemoryScope = `project:${thread.projectId}`;
    // Incognito and temporary threads learn nothing.
    if (!MemoryAccess.allows(context, "write", scope)) return 0;
    const messageCount = yield* projections.getMessageCount(threadId);
    const { messages } = yield* projections.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["user", "assistant"],
    });
    const input = consolidationInput(messages, (yield* progress(threadId))?.through ?? null);
    if (input.messageCount < MIN_MESSAGES) return 0;
    const runner = yield* textGenerators.runner(choice.model.instanceId);
    if (runner === undefined) return 0;
    const reply = yield* runner({
      operation: LESSONS_OPERATION,
      cwd: "",
      prompt: buildConsolidationPrompt(input.text),
      outputSchema: LessonsReply,
      modelSelection: { instanceId: choice.model.instanceId, model: choice.model.model },
    }).pipe(Effect.timeout(MODEL_TIMEOUT));
    const known = new Set(
      (yield* memory.list({ scopeKind: "project" }))
        .filter((item) => item.scope === scope)
        .map((item) => normalized(item.content)),
    );
    let proposed = 0;
    for (const lesson of proposedLessons(reply)) {
      if (known.has(normalized(lesson))) continue;
      // An agent's write: a pending, agent-inferred fact until a person accepts it.
      yield* memory.remember({ context, scope, kind: "fact", content: lesson, actor: "agent" });
      proposed += 1;
    }
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* sql`INSERT INTO lesson_threads (thread_id, through, message_count, consolidated_at)
      VALUES (${threadId}, ${input.through}, ${messageCount}, ${at})
      ON CONFLICT (thread_id) DO UPDATE SET through = excluded.through,
        message_count = excluded.message_count, consolidated_at = excluded.consolidated_at`;
    return proposed;
  });

  const consolidate: Lessons["Service"]["consolidate"] = (threadId) =>
    gate
      .withPermits(1)(pass(threadId))
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("A lesson pass failed; it runs again on the next trigger.", cause).pipe(
            Effect.as(0),
          ),
        ),
      );

  const optedIn = decisions.status.pipe(
    Effect.map((status) =>
      status.consents.flatMap((consent) =>
        consent.point === "lessons" && consent.projectId !== null ? [consent.projectId] : [],
      ),
    ),
  );

  /** Watches settled turns in opted-in projects: a pass at the threshold, else after the idle wait. */
  const worker = Effect.fn("Lessons.worker")(function* (projectIds: ReadonlyArray<ProjectId>) {
    const idle = yield* FiberMap.make<ThreadId>();
    const settled = yield* hub.subscribe({ types: ["thread.run_settled"], projectIds });
    yield* settled.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type !== "thread.run_settled" || event.threadId === null) return;
          if (event.outcome !== "completed") return;
          const threadId = event.threadId;
          const count = yield* projections.getMessageCount(threadId);
          const since = count - ((yield* progress(threadId))?.messageCount ?? 0);
          yield* FiberMap.run(
            idle,
            threadId,
            since >= MESSAGE_THRESHOLD
              ? consolidate(threadId)
              : Effect.sleep(IDLE).pipe(Effect.andThen(consolidate(threadId))),
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Lessons could not read a settled turn.", cause),
          ),
        ),
      ),
    );
  }, Effect.scoped);

  /** Runs the worker while any project is opted in and stops it with the last; inert otherwise. */
  const sync = transitions.withPermits(1)(
    Effect.gen(function* () {
      const projectIds = yield* optedIn;
      if (projectIds.length === 0) yield* FiberHandle.clear(active);
      else yield* FiberHandle.run(active, worker(projectIds));
    }),
  );

  const setProject: Lessons["Service"]["setProject"] = Effect.fn("Lessons.setProject")(
    function* (input) {
      yield* decisions.setConsent({
        point: "lessons",
        projectId: input.projectId,
        source: input.source,
      });
      yield* sync;
    },
  );

  yield* sync.pipe(
    Effect.catchCause((cause) => Effect.logWarning("Lessons could not start.", cause)),
  );
  return Lessons.of({ setProject, consolidate });
});

export const layer = Layer.effect(Lessons, make).pipe(Layer.provide(ProjectionStore.layer));
