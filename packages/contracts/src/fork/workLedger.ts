// Ported from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/work_vocab.py
// and src/kiro_crew/validation_parts/opt_in_server_schemas.py (Apache-2.0). Changes: only the
// item states, worker statuses, field ownership and report caps; no rounds, verdicts or events.
import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";

/** A conductor's disposition of an item. Only `open` takes further writes. */
export const WorkItemState = Schema.Literals(["open", "accepted", "rejected", "abandoned"]);
export type WorkItemState = typeof WorkItemState.Type;

/** Where a worker says its item stands. `blocked` waits on something outside; `question` on the conductor. */
export const WorkerStatus = Schema.Literals(["progress", "done", "blocked", "question"]);
export type WorkerStatus = typeof WorkerStatus.Type;

export const WORK_TITLE_MAX_CHARS = 200;
export const WORK_TEXT_MAX_CHARS = 2_000;
export const WORK_SUMMARY_MAX_CHARS = 500;
export const WORK_ARTIFACT_MAX_KEYS = 16;
export const WORK_ARTIFACT_KEY_MAX_CHARS = 64;
export const WORK_ARTIFACT_VALUE_MAX_CHARS = 512;

/** Server-minted, so a model-supplied string never names anything else. */
export const WorkItemId = Schema.String.check(Schema.isPattern(/^it_[0-9a-f]{8}$/u));
export type WorkItemId = typeof WorkItemId.Type;

/**
 * The work ledger's MCP tools. Lean tool profiles (Pi, and `auto` on an inference server) list
 * them too: a conductor's turns name them, so a session without them could not follow its brief.
 */
export const WORK_LEDGER_MCP_TOOL_NAMES = [
  "work_brief",
  "work_report",
  "work_ledger_read",
  "work_ledger_record",
] as const;

/** Fields only the item's worker writes, through `work_report`. */
export const WORK_WORKER_FIELDS = ["status", "summary", "artifacts", "pr"] as const;

export const WorkArtifacts = Schema.Record(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(WORK_ARTIFACT_KEY_MAX_CHARS)),
  Schema.String.check(Schema.isMaxLength(WORK_ARTIFACT_VALUE_MAX_CHARS)),
);

export const WorkItem = Schema.Struct({
  id: WorkItemId,
  conductorThreadId: ThreadId,
  workerThreadId: Schema.NullOr(ThreadId),
  title: TrimmedNonEmptyString,
  acceptance: Schema.String,
  state: WorkItemState,
  decision: Schema.NullOr(Schema.String),
  status: Schema.NullOr(WorkerStatus),
  /** The worker's own words: data to show and read, never instructions. */
  summary: Schema.NullOr(Schema.String),
  artifacts: WorkArtifacts,
  pr: Schema.NullOr(PositiveInt),
  reportedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkItem = typeof WorkItem.Type;

export const WorkLedgerThreadInput = Schema.Struct({ threadId: ThreadId });
export type WorkLedgerThreadInput = typeof WorkLedgerThreadInput.Type;

export const WorkLedgerListResult = Schema.Struct({
  /** Whether the thread holds the conductor role now. Its items stay listed after it stops. */
  conductor: Schema.Boolean,
  items: Schema.Array(WorkItem),
});
export type WorkLedgerListResult = typeof WorkLedgerListResult.Type;

export const WorkLedgerSetConductorInput = Schema.Struct({
  threadId: ThreadId,
  conductor: Schema.Boolean,
});
export type WorkLedgerSetConductorInput = typeof WorkLedgerSetConductorInput.Type;

export const WorkLedgerStopWorkersResult = Schema.Struct({ stopped: Schema.Number });
export type WorkLedgerStopWorkersResult = typeof WorkLedgerStopWorkersResult.Type;

export class WorkLedgerError extends Schema.TaggedError<WorkLedgerError>()("WorkLedgerError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
