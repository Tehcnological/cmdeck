import * as Schema from "effect/Schema";

/** A detail value; strings pass through the redactor before they are stored. */
export const AuditDetailValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);
export type AuditDetailValue = typeof AuditDetailValue.Type;

export const AuditEntry = Schema.Struct({
  /** Position in the chain, from 1; pruning removes the oldest without renumbering. */
  seq: Schema.Number,
  occurredAt: Schema.Number,
  /** Open-ended so later modules can add kinds without a contract change. */
  kind: Schema.String,
  actor: Schema.NullOr(Schema.String),
  subject: Schema.NullOr(Schema.String),
  detail: Schema.Record(Schema.String, AuditDetailValue),
  hash: Schema.String,
});
export type AuditEntry = typeof AuditEntry.Type;

export const AuditListInput = Schema.Struct({
  /** Entries before this seq; absent starts at the newest. */
  beforeSeq: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number),
});
export type AuditListInput = typeof AuditListInput.Type;

export const AuditListResult = Schema.Struct({
  /** Newest first. */
  entries: Schema.Array(AuditEntry),
  hasMore: Schema.Boolean,
});
export type AuditListResult = typeof AuditListResult.Type;

/**
 * `content_changed`: a stored row no longer matches its hash. `chain_broken`: a row does not follow
 * the one before it (one was removed or inserted). `start_unanchored`: the oldest row is neither the
 * first ever nor the one after the last pruned entry.
 */
export const AuditBreakReason = Schema.Literals([
  "content_changed",
  "chain_broken",
  "start_unanchored",
]);
export type AuditBreakReason = typeof AuditBreakReason.Type;

export const AuditVerifyResult = Schema.Struct({
  ok: Schema.Boolean,
  checked: Schema.Number,
  /** The first entry that fails, when one does. */
  brokenSeq: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(AuditBreakReason),
});
export type AuditVerifyResult = typeof AuditVerifyResult.Type;

export class AuditLogError extends Schema.TaggedError<AuditLogError>()("AuditLogError", {
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return "Could not read the audit log.";
  }
}
