// Ported from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/work_ledger.py
// (Apache-2.0). Changes: a SQLite table instead of per-item files and an event log; a delegated
// child of the item's conductor may claim an unbound item, since a T3 worker exists only once
// delegate_task has started it; no rounds, verdicts, acceptance evaluator or patrol.
import {
  ThreadId,
  WORK_ARTIFACT_MAX_KEYS,
  WORK_SUMMARY_MAX_CHARS,
  WORK_TEXT_MAX_CHARS,
  WORK_TITLE_MAX_CHARS,
  WorkArtifacts,
  WorkItem,
  WorkItemId,
  WorkerStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";

/** Open items one conductor may hold at once; Kiro's board cap. */
const WORK_OPEN_ITEM_LIMIT = 32;

export class WorkLedgerStoreError extends Schema.TaggedError<WorkLedgerStoreError>()(
  "WorkLedgerStoreError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The work ledger could not ${this.operation}.`;
  }
}

/** A write the ledger refuses, named by `code` so an agent can act on it. */
export class WorkLedgerRefusal extends Schema.TaggedError<WorkLedgerRefusal>()(
  "WorkLedgerRefusal",
  {
    code: Schema.Literals([
      "invalid_value",
      "unknown_item",
      "item_closed",
      "already_bound",
      "not_bound",
      "not_your_item",
      "done_without_evidence",
      "too_many_open_items",
    ]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `${this.code}: ${this.detail}`;
  }
}

const Title = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(WORK_TITLE_MAX_CHARS),
);
const LongText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WORK_TEXT_MAX_CHARS),
);

/**
 * Everything a conductor may write, one action at a time. No action names a worker field, so a
 * conductor cannot write a report.
 */
export const ConductorWrite = Schema.Union([
  Schema.Struct({ action: Schema.Literal("create"), title: Title, acceptance: LongText }),
  Schema.Struct({ action: Schema.Literal("bind"), itemId: WorkItemId, workerThreadId: ThreadId }),
  Schema.Struct({ action: Schema.Literal("decide"), itemId: WorkItemId, decision: LongText }),
  Schema.Struct({
    action: Schema.Literal("close"),
    itemId: WorkItemId,
    state: Schema.Literals(["accepted", "rejected", "abandoned"]),
    decision: Schema.optionalKey(LongText),
  }),
]);
export type ConductorWrite = typeof ConductorWrite.Type;

/**
 * Everything a worker may write. Its keys are exactly `WORK_WORKER_FIELDS`, and it is decoded with
 * excess properties refused, so a report naming a conductor field fails instead of dropping it.
 */
export const WorkerReport = Schema.Struct({
  status: WorkerStatus,
  summary: Schema.String.check(Schema.isMinLength(1)),
  artifacts: Schema.optionalKey(WorkArtifacts),
  pr: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000_000 })),
  ),
});
export type WorkerReport = typeof WorkerReport.Type;

/** What a worker sees of its item: no conductor goal, no sibling items, no worker thread ids. */
export interface WorkBrief {
  readonly itemId: WorkItemId;
  readonly title: string;
  readonly acceptance: string;
  readonly decision: string | null;
  readonly status: WorkerStatus | null;
  readonly summary: string | null;
}

const strict = { onExcessProperty: "error" } as const;
const decodeConductorWrite = Schema.decodeUnknownEffect(ConductorWrite);
const decodeWorkerReport = Schema.decodeUnknownEffect(WorkerReport);
const decodeItem = Schema.decodeUnknownSync(WorkItem);
const ArtifactsJson = Schema.fromJsonString(WorkArtifacts);
const decodeArtifacts = Schema.decodeUnknownSync(ArtifactsJson);
const encodeArtifacts = Schema.encodeEffect(ArtifactsJson);

const invalid = (detail: string) => new WorkLedgerRefusal({ code: "invalid_value", detail });

/** Cuts the summary to its cap and says so in the stored text, as Kiro's clamp does. */
export const clampSummary = (summary: string): { readonly text: string; readonly cut: number } => {
  if (summary.length <= WORK_SUMMARY_MAX_CHARS) return { text: summary, cut: 0 };
  const cut = summary.length - WORK_SUMMARY_MAX_CHARS;
  const note = ` [${cut} characters cut]`;
  return { text: `${summary.slice(0, WORK_SUMMARY_MAX_CHARS - note.length)}${note}`, cut };
};

interface ItemRow {
  readonly id: string;
  readonly conductorThreadId: string;
  readonly workerThreadId: string | null;
  readonly title: string;
  readonly acceptance: string;
  readonly state: string;
  readonly decision: string | null;
  readonly status: string | null;
  readonly summary: string | null;
  readonly artifactsJson: string;
  readonly pr: number | null;
  readonly reportedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const toItem = ({ artifactsJson, ...row }: ItemRow): WorkItem =>
  decodeItem({ ...row, artifacts: decodeArtifacts(artifactsJson) });

export type WorkLedgerError = WorkLedgerRefusal | WorkLedgerStoreError;

export class WorkLedger extends Context.Service<
  WorkLedger,
  {
    /** Started as a conductor by a person, or has written to its own ledger. */
    readonly isConductor: (threadId: ThreadId) => Effect.Effect<boolean, WorkLedgerStoreError>;
    /** A person starts or ends a thread's conductor role. Its items stay either way. */
    readonly setConductor: (
      threadId: ThreadId,
      conductor: boolean,
    ) => Effect.Effect<void, WorkLedgerStoreError>;
    /** The conductor's items, oldest first. */
    readonly list: (
      conductorThreadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<WorkItem>, WorkLedgerStoreError>;
    /** One conductor action on the caller's own ledger. `input` is decoded here. */
    readonly record: (
      conductorThreadId: ThreadId,
      input: unknown,
    ) => Effect.Effect<WorkItem, WorkLedgerError>;
    /** The worker's open item, claiming `itemId` when it is unbound and the caller may take it. */
    readonly brief: (
      workerThreadId: ThreadId,
      itemId?: WorkItemId,
    ) => Effect.Effect<WorkBrief, WorkLedgerError>;
    /** Writes worker fields only. `input` is decoded here with excess fields refused. */
    readonly report: (
      workerThreadId: ThreadId,
      input: unknown,
      itemId?: WorkItemId,
    ) => Effect.Effect<{ readonly item: WorkItem; readonly cut: number }, WorkLedgerError>;
  }
>()("t3/fork/workLedger/WorkLedger") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const random = yield* SecureRandom.SecureRandom;

  const failsTo =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new WorkLedgerStoreError({ operation, cause })));

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const selectItems = sql.literal(`SELECT id, conductor_thread_id AS "conductorThreadId",
    worker_thread_id AS "workerThreadId", title, acceptance, state, decision, status, summary,
    artifacts_json AS "artifactsJson", pr, reported_at AS "reportedAt", created_at AS "createdAt",
    updated_at AS "updatedAt" FROM work_items`);

  const findItem = (itemId: string) =>
    sql<ItemRow>`${selectItems} WHERE id = ${itemId}`.pipe(
      Effect.map((rows) => Option.map(Option.fromUndefinedOr(rows[0]), toItem)),
      failsTo("read an item"),
    );

  const requireItem = (itemId: string) =>
    findItem(itemId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new WorkLedgerRefusal({ code: "unknown_item", detail: itemId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const requireOpen = (item: WorkItem) =>
    item.state === "open"
      ? Effect.succeed(item)
      : Effect.fail(
          new WorkLedgerRefusal({
            code: "item_closed",
            detail: `${item.id} is ${item.state} and takes no more writes.`,
          }),
        );

  const openItemOf = (workerThreadId: ThreadId) =>
    sql<ItemRow>`${selectItems} WHERE worker_thread_id = ${workerThreadId} AND state = 'open'
      ORDER BY created_at DESC LIMIT 1`.pipe(
      Effect.map((rows) => Option.map(Option.fromUndefinedOr(rows[0]), toItem)),
      failsTo("read the worker's item"),
    );

  const registerConductor = (threadId: ThreadId) =>
    now.pipe(
      Effect.flatMap(
        (at) =>
          sql`INSERT INTO work_conductors (thread_id, started_at) VALUES (${threadId}, ${at})
            ON CONFLICT (thread_id) DO NOTHING`,
      ),
      failsTo("start the conductor"),
    );

  /** A worker holds one open item, so a second binding would strand the first one's reports. */
  const assertUnboundWorker = (workerThreadId: ThreadId, itemId: WorkItemId) =>
    openItemOf(workerThreadId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (held) =>
            held.id === itemId
              ? Effect.void
              : Effect.fail(
                  new WorkLedgerRefusal({
                    code: "already_bound",
                    detail: `Thread ${workerThreadId} already works on open item ${held.id}.`,
                  }),
                ),
        }),
      ),
    );

  const bind = Effect.fn("WorkLedger.bind")(function* (item: WorkItem, workerThreadId: ThreadId) {
    yield* requireOpen(item);
    if (item.workerThreadId !== null && item.workerThreadId !== workerThreadId) {
      return yield* new WorkLedgerRefusal({
        code: "already_bound",
        detail: `${item.id} is bound to thread ${item.workerThreadId}.`,
      });
    }
    yield* assertUnboundWorker(workerThreadId, item.id);
    const at = yield* now;
    yield* sql`UPDATE work_items SET worker_thread_id = ${workerThreadId}, updated_at = ${at}
        WHERE id = ${item.id} AND state = 'open'`.pipe(failsTo("bind the worker"));
    return { ...item, workerThreadId, updatedAt: at };
  });

  /**
   * The caller's item: the one named, when it is the caller's or the caller may claim it, else
   * the caller's open item. Only a thread delegated from the item's conductor may claim it.
   */
  const resolveWorkerItem = Effect.fn("WorkLedger.resolveWorkerItem")(function* (
    workerThreadId: ThreadId,
    itemId: WorkItemId | undefined,
  ) {
    if (itemId === undefined) {
      const held = yield* openItemOf(workerThreadId);
      if (Option.isNone(held)) {
        return yield* new WorkLedgerRefusal({
          code: "not_bound",
          detail:
            "No open work item is bound to this thread. The message you were given is your whole task.",
        });
      }
      return held.value;
    }
    const item = yield* requireItem(itemId);
    if (item.workerThreadId === workerThreadId) return item;
    const thread = yield* projections
      .findThread(workerThreadId)
      .pipe(failsTo("read the worker's thread"));
    if (item.workerThreadId !== null || thread?.lineage.parentThreadId !== item.conductorThreadId) {
      return yield* new WorkLedgerRefusal({
        code: "not_your_item",
        detail: `${item.id} belongs to another worker or another conductor.`,
      });
    }
    return yield* bind(item, workerThreadId);
  });

  const isConductor: WorkLedger["Service"]["isConductor"] = (threadId) =>
    sql<{
      readonly found: number;
    }>`SELECT 1 AS found FROM work_conductors WHERE thread_id = ${threadId}
      UNION ALL SELECT 1 FROM work_items WHERE conductor_thread_id = ${threadId} LIMIT 1`.pipe(
      Effect.map((rows) => rows.length > 0),
      failsTo("read the conductor"),
    );

  const setConductor: WorkLedger["Service"]["setConductor"] = (threadId, conductor) =>
    conductor
      ? registerConductor(threadId)
      : sql`DELETE FROM work_conductors WHERE thread_id = ${threadId}`.pipe(
          Effect.asVoid,
          failsTo("end the conductor"),
        );

  const list: WorkLedger["Service"]["list"] = (conductorThreadId) =>
    sql<ItemRow>`${selectItems} WHERE conductor_thread_id = ${conductorThreadId}
      ORDER BY created_at, id`.pipe(
      Effect.map((rows) => rows.map(toItem)),
      failsTo("read the ledger"),
    );

  const record: WorkLedger["Service"]["record"] = Effect.fn("WorkLedger.record")(
    function* (conductorThreadId, input) {
      const write = yield* decodeConductorWrite(input, strict).pipe(
        Effect.mapError((error) => invalid(error.message)),
      );
      if (write.action === "create") {
        const [{ open = 0 } = {}] = yield* sql<{
          readonly open: number;
        }>`SELECT COUNT(*) AS open FROM work_items
        WHERE conductor_thread_id = ${conductorThreadId} AND state = 'open'`.pipe(
          failsTo("count open items"),
        );
        if (open >= WORK_OPEN_ITEM_LIMIT) {
          return yield* new WorkLedgerRefusal({
            code: "too_many_open_items",
            detail: `Close some of your ${open} open items before creating more.`,
          });
        }
        const bytes = yield* random.randomBytes(4);
        const id = `it_${Buffer.from(bytes).toString("hex")}`;
        const at = yield* now;
        yield* registerConductor(conductorThreadId);
        yield* sql`INSERT INTO work_items (id, conductor_thread_id, title, acceptance, state,
        created_at, updated_at)
        VALUES (${id}, ${conductorThreadId}, ${write.title}, ${write.acceptance}, 'open', ${at}, ${at})`.pipe(
          failsTo("create the item"),
        );
        return yield* requireItem(id);
      }
      const item = yield* requireItem(write.itemId);
      // Another conductor's item reads as unknown, so a guess learns nothing.
      if (item.conductorThreadId !== conductorThreadId) {
        return yield* new WorkLedgerRefusal({ code: "unknown_item", detail: write.itemId });
      }
      yield* requireOpen(item);
      const at = yield* now;
      switch (write.action) {
        case "bind":
          return yield* bind(item, write.workerThreadId);
        case "decide":
          yield* sql`UPDATE work_items SET decision = ${write.decision}, updated_at = ${at}
          WHERE id = ${item.id}`.pipe(failsTo("record the decision"));
          break;
        case "close":
          yield* sql`UPDATE work_items SET state = ${write.state},
          decision = ${write.decision ?? item.decision}, updated_at = ${at}
          WHERE id = ${item.id}`.pipe(failsTo("close the item"));
          break;
      }
      return yield* requireItem(item.id);
    },
  );

  const brief: WorkLedger["Service"]["brief"] = Effect.fn("WorkLedger.brief")(
    function* (workerThreadId, itemId) {
      const item = yield* resolveWorkerItem(workerThreadId, itemId);
      return {
        itemId: item.id,
        title: item.title,
        acceptance: item.acceptance,
        decision: item.decision,
        status: item.status,
        summary: item.summary,
      } satisfies WorkBrief;
    },
  );

  const report: WorkLedger["Service"]["report"] = Effect.fn("WorkLedger.report")(
    function* (workerThreadId, input, itemId) {
      const fields = yield* decodeWorkerReport(input, strict).pipe(
        Effect.mapError((error) => invalid(error.message)),
      );
      const artifacts = fields.artifacts ?? {};
      if (Object.keys(artifacts).length > WORK_ARTIFACT_MAX_KEYS) {
        return yield* invalid(`artifacts holds at most ${WORK_ARTIFACT_MAX_KEYS} keys.`);
      }
      if (
        fields.status === "done" &&
        Object.keys(artifacts).length === 0 &&
        fields.pr === undefined
      ) {
        return yield* new WorkLedgerRefusal({
          code: "done_without_evidence",
          detail:
            "A done report names its evidence in artifacts or pr. A check that could not run is still an artifact that says so.",
        });
      }
      const item = yield* resolveWorkerItem(workerThreadId, itemId).pipe(
        Effect.flatMap(requireOpen),
      );
      const summary = clampSummary(fields.summary);
      const artifactsJson = yield* encodeArtifacts(artifacts).pipe(
        Effect.mapError((error) => invalid(error.message)),
      );
      const at = yield* now;
      // Names worker columns only, and only for the bound worker of an open item.
      yield* sql`UPDATE work_items SET status = ${fields.status}, summary = ${summary.text},
      artifacts_json = ${artifactsJson}, pr = ${fields.pr ?? null},
      reported_at = ${at}, updated_at = ${at}
      WHERE id = ${item.id} AND worker_thread_id = ${workerThreadId} AND state = 'open'`.pipe(
        failsTo("record the report"),
      );
      return { item: yield* requireItem(item.id), cut: summary.cut };
    },
  );

  return WorkLedger.of({ isConductor, setConductor, list, record, brief, report });
});

export const layer = Layer.effect(WorkLedger, make);
