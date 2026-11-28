// State card fields, caps and terminal phases ported from Kiro Crew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// src/kiro_crew/session_ledger.py and session_ledger_layout.py (Apache-2.0). Changed: one SQLite row
// per thread instead of a fold of the crew log; no artifacts, events or upgrade carry; tried list
// capped at 10; fields redacted on write.
import {
  SESSION_STATE_PHASE_MAX,
  SESSION_STATE_TEXT_MAX,
  SESSION_STATE_TRIED_MAX,
  type SessionStateCard,
  SessionStateError,
  SessionStateTried,
  isSessionStateFinished,
  ThreadId,
} from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** Fields a record call sets; one it leaves undefined keeps its stored value. */
export interface SessionStatePatch {
  readonly goal?: string | undefined;
  readonly phase?: string | undefined;
  readonly next?: string | undefined;
  /** Appended to the tried list, with the reason it was rejected. */
  readonly triedApproach?: string | undefined;
  readonly triedRejectedBecause?: string | undefined;
}

const TriedJson = Schema.fromJsonString(Schema.Array(SessionStateTried));
const decodeTried = Schema.decodeUnknownEffect(TriedJson);
const encodeTried = Schema.encodeEffect(TriedJson);

const clean = (text: string, max: number) => redactSecrets(text).trim().slice(0, max);

interface Row {
  readonly threadId: string;
  readonly goal: string;
  readonly phase: string;
  readonly next: string;
  readonly triedJson: string;
  readonly updatedAt: string;
  readonly injectedAt: string | null;
}

const toCard = (row: Row) =>
  decodeTried(row.triedJson).pipe(
    Effect.map((tried): SessionStateCard => ({
      threadId: ThreadId.make(row.threadId),
      goal: row.goal,
      phase: row.phase,
      next: row.next,
      tried,
      updatedAt: row.updatedAt,
      injectedAt: row.injectedAt,
    })),
  );

export class SessionState extends Context.Service<
  SessionState,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<SessionStateCard | null, SessionStateError>;
    readonly record: (
      threadId: ThreadId,
      patch: SessionStatePatch,
    ) => Effect.Effect<SessionStateCard, SessionStateError>;
    /** Clearing a thread without a card succeeds. */
    readonly clear: (threadId: ThreadId) => Effect.Effect<void, SessionStateError>;
    /**
     * The card a turn should carry: on an automated turn, or after a compaction the card has not
     * reached the provider since. Never for a card in a terminal phase.
     */
    readonly dueForTurn: (input: {
      readonly threadId: ThreadId;
      readonly automated: boolean;
    }) => Effect.Effect<SessionStateCard | undefined, SessionStateError>;
    readonly markInjected: (threadId: ThreadId) => Effect.Effect<void, SessionStateError>;
  }
>()("t3/fork/sessionState/SessionState") {}

/** Needs only SQL, so the turn context builds its own instance beneath orchestration. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const unavailable = Effect.mapError(
    (cause: unknown) => new SessionStateError({ reason: "unavailable", cause }),
  );
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const get = Effect.fn("SessionState.get")(function* (threadId: ThreadId) {
    const rows = yield* sql<Row>`SELECT thread_id AS "threadId", goal, phase, next_step AS "next",
        tried_json AS "triedJson", updated_at AS "updatedAt", injected_at AS "injectedAt"
      FROM session_state_cards WHERE thread_id = ${threadId}`.pipe(unavailable);
    const [row] = rows;
    return row === undefined ? null : yield* toCard(row).pipe(unavailable);
  });

  const record = Effect.fn("SessionState.record")(function* (
    threadId: ThreadId,
    patch: SessionStatePatch,
  ) {
    const triedApproach = patch.triedApproach?.trim() ?? "";
    if (
      patch.goal === undefined &&
      patch.phase === undefined &&
      patch.next === undefined &&
      triedApproach === ""
    ) {
      return yield* new SessionStateError({ reason: "empty" });
    }
    const updatedAt = yield* now;
    // One transaction, so two concurrent records cannot drop each other's tried approach.
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* get(threadId);
          const tried = [
            ...(current?.tried ?? []),
            ...(triedApproach === ""
              ? []
              : [
                  {
                    approach: clean(triedApproach, SESSION_STATE_TEXT_MAX),
                    rejectedBecause: clean(
                      patch.triedRejectedBecause ?? "",
                      SESSION_STATE_TEXT_MAX,
                    ),
                  },
                ]),
          ].slice(-SESSION_STATE_TRIED_MAX);
          const card: SessionStateCard = {
            threadId,
            goal:
              patch.goal === undefined
                ? (current?.goal ?? "")
                : clean(patch.goal, SESSION_STATE_TEXT_MAX),
            phase:
              patch.phase === undefined
                ? (current?.phase ?? "")
                : clean(patch.phase, SESSION_STATE_PHASE_MAX),
            next:
              patch.next === undefined
                ? (current?.next ?? "")
                : clean(patch.next, SESSION_STATE_TEXT_MAX),
            tried,
            updatedAt,
            injectedAt: current?.injectedAt ?? null,
          };
          const triedJson = yield* encodeTried(tried);
          yield* sql`INSERT INTO session_state_cards
            (thread_id, goal, phase, next_step, tried_json, updated_at, injected_at)
          VALUES (${threadId}, ${card.goal}, ${card.phase}, ${card.next}, ${triedJson},
            ${updatedAt}, ${card.injectedAt})
          ON CONFLICT (thread_id) DO UPDATE SET goal = excluded.goal, phase = excluded.phase,
            next_step = excluded.next_step, tried_json = excluded.tried_json,
            updated_at = excluded.updated_at`.pipe(unavailable);
          return card;
        }),
      )
      .pipe(unavailable);
  });

  const clear = Effect.fn("SessionState.clear")(function* (threadId: ThreadId) {
    yield* sql`DELETE FROM session_state_cards WHERE thread_id = ${threadId}`.pipe(unavailable);
  });

  const dueForTurn = Effect.fn("SessionState.dueForTurn")(function* (input: {
    readonly threadId: ThreadId;
    readonly automated: boolean;
  }) {
    const card = yield* get(input.threadId);
    if (card === null || isSessionStateFinished(card.phase)) return undefined;
    if (input.automated) return card;
    // Adapters that report compaction (Claude, Codex) leave a completed compaction item.
    const [latest] = yield* sql<{ readonly at: string | null }>`SELECT MAX(updated_at) AS at
      FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ${input.threadId} AND type = 'compaction' AND status = 'completed'`.pipe(
      unavailable,
    );
    const seen =
      card.injectedAt !== null && card.injectedAt > card.updatedAt
        ? card.injectedAt
        : card.updatedAt;
    return latest?.at != null && latest.at > seen ? card : undefined;
  });

  const markInjected = Effect.fn("SessionState.markInjected")(function* (threadId: ThreadId) {
    const at = yield* now;
    yield* sql`UPDATE session_state_cards SET injected_at = ${at} WHERE thread_id = ${threadId}`.pipe(
      unavailable,
    );
  });

  return SessionState.of({ get, record, clear, dueForTurn, markInjected });
});

export const layer = Layer.effect(SessionState, make);
