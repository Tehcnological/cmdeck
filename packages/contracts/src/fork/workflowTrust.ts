import * as Schema from "effect/Schema";

/** The problem a workflow file shows until its bytes are approved; clients match it to offer approval. */
export const WORKFLOW_NEEDS_APPROVAL =
  "Needs approval: this file is new or changed, so it does not run until you approve it in Workflows.";

/** A workflow file the server does not run until a person approves these exact bytes. */
export const PendingWorkflowFile = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
  /** The bytes being approved, as text, so what a person reads is what the hash covers. */
  source: Schema.String,
});
export type PendingWorkflowFile = typeof PendingWorkflowFile.Type;

export const WorkflowTrustPendingResult = Schema.Struct({
  files: Schema.Array(PendingWorkflowFile),
});
export type WorkflowTrustPendingResult = typeof WorkflowTrustPendingResult.Type;

export const WorkflowTrustApproveInput = Schema.Struct({
  path: Schema.String,
  sha256: Schema.String,
});
export type WorkflowTrustApproveInput = typeof WorkflowTrustApproveInput.Type;

export const WorkflowPresetInstallInput = Schema.Struct({ id: Schema.String });
export type WorkflowPresetInstallInput = typeof WorkflowPresetInstallInput.Type;

export class WorkflowTrustError extends Schema.TaggedError<WorkflowTrustError>()(
  "WorkflowTrustError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}
