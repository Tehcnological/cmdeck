// Fork-only. A local, hash-chained record of security-relevant actions (WI-1.03).
import {
  AuditDetailValue,
  AuditLogError,
  type AuditBreakReason,
  type AuditEntry,
  type AuditListInput,
  type AuditListResult,
  type AuditVerifyResult,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import { ensureAuditSchema } from "./schema.ts";

const GENESIS_HASH = "0".repeat(64);
/** Written after each prune; its `lastPrunedHash` anchors the oldest entry that remains. */
export const PRUNED_KIND = "audit.pruned";
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const VERIFY_PAGE = 500;
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;

export interface AuditEventInput {
  readonly kind: string;
  readonly actor?: string | null | undefined;
  readonly subject?: string | null | undefined;
  readonly detail?: Readonly<Record<string, AuditDetailValue>> | undefined;
}

export class AuditLog extends Context.Service<
  AuditLog,
  {
    /** Never fails the caller: an entry that cannot be written is logged as a warning instead. */
    readonly append: (event: AuditEventInput) => Effect.Effect<void>;
    readonly list: (input: AuditListInput) => Effect.Effect<AuditListResult, AuditLogError>;
    readonly verify: Effect.Effect<AuditVerifyResult, AuditLogError>;
    /** Removes entries older than the retention window; returns how many it removed. */
    readonly prune: Effect.Effect<number, AuditLogError>;
  }
>()("t3/fork/audit/AuditLog") {}

interface Row {
  readonly seq: number;
  readonly occurred_at: number;
  readonly kind: string;
  readonly actor: string | null;
  readonly subject: string | null;
  readonly detail_json: string;
  readonly prev_hash: string;
  readonly hash: string;
}

const Detail = Schema.Record(Schema.String, AuditDetailValue);
const decodeDetail = Schema.decodeUnknownOption(Schema.fromJsonString(Detail));
const PrunedDetail = Schema.fromJsonString(
  Schema.Struct({ throughSeq: Schema.Number, lastPrunedHash: Schema.String }),
);
const decodePrunedDetail = Schema.decodeUnknownOption(PrunedDetail);
const encodeDetail = Schema.encodeSync(Schema.fromJsonString(Detail));
// Hash input; changing this encoding would break every chain written before it.
const encodeHashInput = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const redact = (value: string | null | undefined) =>
  value === null || value === undefined ? null : redactSecrets(value);

const toEntry = (row: Row): AuditEntry => ({
  seq: row.seq,
  occurredAt: row.occurred_at,
  kind: row.kind,
  actor: row.actor,
  subject: row.subject,
  detail: Option.getOrElse(decodeDetail(row.detail_json), () => ({})),
  hash: row.hash,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const digester = yield* Digest.Digest;
  // One writer at a time: each entry reads the previous hash before it inserts.
  const lock = yield* Semaphore.make(1);
  const toError = (cause: unknown) => new AuditLogError({ cause });

  const hashOf = (row: Omit<Row, "hash">) =>
    digester
      .digest(
        Digest.sha256,
        new TextEncoder().encode(
          encodeHashInput([
            row.prev_hash,
            row.seq,
            row.occurred_at,
            row.kind,
            row.actor,
            row.subject,
            row.detail_json,
          ]),
        ),
      )
      .pipe(Effect.orDie, Effect.map(Hex.encode));

  const readTail = sql<{
    readonly seq: number;
    readonly hash: string;
  }>`SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1`.pipe(
    Effect.map((rows) => rows[0]),
  );

  // `tail` is passed by a prune, which may have just deleted every row.
  const insert = Effect.fn("AuditLog.insert")(function* (
    event: AuditEventInput,
    tail?: { readonly seq: number; readonly hash: string },
  ) {
    const last = tail ?? (yield* readTail);
    const detail: Record<string, AuditDetailValue> = {};
    for (const [key, value] of Object.entries(event.detail ?? {})) {
      detail[key] = typeof value === "string" ? redactSecrets(value) : value;
    }
    const unhashed = {
      seq: (last?.seq ?? 0) + 1,
      occurred_at: yield* Clock.currentTimeMillis,
      kind: redactSecrets(event.kind),
      actor: redact(event.actor),
      subject: redact(event.subject),
      detail_json: encodeDetail(detail),
      prev_hash: last?.hash ?? GENESIS_HASH,
    };
    const hash = yield* hashOf(unhashed);
    yield* sql`INSERT INTO audit_events ${sql.insert({ ...unhashed, hash })}`;
  });

  const append: AuditLog["Service"]["append"] = (event) =>
    insert(event).pipe(
      sql.withTransaction,
      lock.withPermits(1),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not write an audit entry", { kind: event.kind, cause }),
      ),
    );

  const list: AuditLog["Service"]["list"] = Effect.fn("AuditLog.list")(function* (input) {
    const limit = Math.min(
      Math.max(Math.trunc(input.limit ?? LIST_LIMIT_DEFAULT), 1),
      LIST_LIMIT_MAX,
    );
    const rows =
      input.beforeSeq === undefined
        ? yield* sql<Row>`SELECT * FROM audit_events ORDER BY seq DESC LIMIT ${limit + 1}`
        : yield* sql<Row>`SELECT * FROM audit_events WHERE seq < ${input.beforeSeq}
              ORDER BY seq DESC LIMIT ${limit + 1}`;
    return { entries: rows.slice(0, limit).map(toEntry), hasMore: rows.length > limit };
  }, Effect.mapError(toError));

  // The oldest entry is either the first ever or follows the last entry a prune removed.
  const isAnchored = Effect.fn("AuditLog.isAnchored")(function* (first: Row) {
    if (first.seq === 1 && first.prev_hash === GENESIS_HASH) return true;
    const prunes = yield* sql<{
      readonly detail_json: string;
    }>`SELECT detail_json FROM audit_events WHERE kind = ${PRUNED_KIND}`;
    return prunes.some((prune) =>
      Option.exists(
        decodePrunedDetail(prune.detail_json),
        (detail) =>
          detail.throughSeq === first.seq - 1 && detail.lastPrunedHash === first.prev_hash,
      ),
    );
  });

  // One read transaction: every page and the anchor come from the same snapshot, so a prune in
  // this server or another process cannot shift pages mid-check. No audit lock is taken, so
  // appends (and the approval feed behind them) never queue behind a verify.
  const verify: AuditLog["Service"]["verify"] = Effect.gen(function* () {
    const broken = (checked: number, seq: number, reason: AuditBreakReason) => ({
      ok: false,
      checked,
      brokenSeq: seq,
      reason,
    });
    let checked = 0;
    let previous: Row | undefined;
    for (;;) {
      const rows = yield* sql<Row>`SELECT * FROM audit_events
        WHERE seq > ${previous?.seq ?? 0} ORDER BY seq LIMIT ${VERIFY_PAGE}`;
      if (rows.length === 0) break;
      for (const row of rows) {
        if ((yield* hashOf(row)) !== row.hash) return broken(checked, row.seq, "content_changed");
        if (previous === undefined) {
          if (!(yield* isAnchored(row))) return broken(checked, row.seq, "start_unanchored");
        } else if (row.seq !== previous.seq + 1 || row.prev_hash !== previous.hash) {
          return broken(checked, row.seq, "chain_broken");
        }
        previous = row;
        checked += 1;
      }
    }
    return { ok: true, checked, brokenSeq: null, reason: null };
  }).pipe(sql.withTransaction, Effect.mapError(toError), Effect.withSpan("AuditLog.verify"));

  const prune: AuditLog["Service"]["prune"] = Effect.gen(function* () {
    const cutoff = (yield* Clock.currentTimeMillis) - RETENTION_MS;
    // Only an unbroken run of old entries from the start goes, so the chain stays one piece.
    const [last] = yield* sql<{ readonly seq: number; readonly hash: string }>`
      SELECT seq, hash FROM audit_events
      WHERE seq < COALESCE(
        (SELECT MIN(seq) FROM audit_events WHERE occurred_at >= ${cutoff}),
        (SELECT MAX(seq) + 1 FROM audit_events)
      )
      ORDER BY seq DESC LIMIT 1`;
    if (last === undefined) return 0;
    const [counted] = yield* sql<{
      readonly n: number;
    }>`SELECT COUNT(*) AS n FROM audit_events WHERE seq <= ${last.seq}`;
    const removed = Number(counted?.n ?? 0);
    const tail = yield* readTail;
    yield* sql`DELETE FROM audit_events WHERE seq <= ${last.seq}`;
    yield* insert(
      {
        kind: PRUNED_KIND,
        actor: "system",
        detail: { throughSeq: last.seq, lastPrunedHash: last.hash, removed },
      },
      tail,
    );
    return removed;
  }).pipe(
    sql.withTransaction,
    lock.withPermits(1),
    Effect.mapError(toError),
    Effect.withSpan("AuditLog.prune"),
  );

  return AuditLog.of({ append, list, verify, prune });
});

/** The log alone, for the CLI and tests. */
export const layerService = Layer.effect(AuditLog, make);

// Approval answers come from the milestone feed, so orchestration needs no audit hook.
export const layerSources = Layer.effectDiscard(
  Effect.gen(function* () {
    const audit = yield* AuditLog;
    const hub = yield* MilestoneHub.MilestoneHub;
    const resolutions = yield* hub.subscribe({
      types: ["thread.input_resolved"],
      includeSubagentChildren: true,
    });
    yield* resolutions.pipe(
      Stream.runForEach((event) =>
        event.type === "thread.input_resolved" && event.kind === "approval"
          ? audit.append({
              kind: "approval.resolved",
              actor: event.actor.type,
              subject: event.threadId,
              detail: {
                requestId: event.requestId,
                resolution: event.resolution,
                projectId: event.projectId,
              },
            })
          : Effect.void,
      ),
      Effect.forkScoped,
    );
    yield* audit.prune.pipe(
      Effect.catch((error) => Effect.logWarning("Could not prune the audit log", { cause: error })),
      Effect.repeat(Schedule.spaced("1 day")),
      Effect.forkScoped,
    );
  }),
);

/** The log with its milestone subscription and daily prune, for the server (ForkLayer). */
export const layer = layerSources.pipe(Layer.provideMerge(layerService));

/**
 * Appends when this process runs the audit log, and does nothing otherwise. Hooks in upstream
 * files use it so their tests and the CLI need no audit layer.
 */
export const note = (event: AuditEventInput): Effect.Effect<void> =>
  Effect.serviceOption(AuditLog).pipe(
    Effect.flatMap((audit) => (Option.isSome(audit) ? audit.value.append(event) : Effect.void)),
  );

export const notePairingApproved = (pairingLinkId: string) =>
  note({ kind: "device.pairing_approved", subject: pairingLinkId });

/** A stored secret was handed out: as a one-use ref's value, or written to a file for commands. */
export const noteSecretReveal = (via: "ref" | "file", subject: string) =>
  note({ kind: "secret.revealed", subject, detail: { via } });

/** Appends to the log in the database at `dbPath`, for CLI commands that run without a server. */
export const appendToDatabase = Effect.fn("AuditLog.appendToDatabase")(
  function* (dbPath: string, event: AuditEventInput) {
    yield* ensureAuditSchema();
    yield* (yield* AuditLog).append(event);
  },
  (effect, dbPath) =>
    effect.pipe(
      Effect.provide(
        layerService.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: dbPath }))),
      ),
      Effect.catch((cause) => Effect.logWarning("Could not write an audit entry", { cause })),
    ),
);
