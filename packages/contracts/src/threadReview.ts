import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import type { ProviderDriverKind } from "./providerInstance.ts";

/**
 * Drivers never offered or accepted as a second-model reviewer, in the picker and on the server.
 * Antigravity stays out until the fork owner lifts the rule; lifting it is deleting its entry.
 */
export const REVIEWER_EXCLUDED_DRIVERS: ReadonlySet<string> = new Set(["antigravity"]);

export const isReviewerDriverAllowed = (driver: ProviderDriverKind): boolean =>
  !REVIEWER_EXCLUDED_DRIVERS.has(driver);

/** Marks the side chat a review runs in, so every client finds a thread's reviews in its shells. */
export const THREAD_REVIEW_TAG = "second-model-review";

export const ThreadReviewStartInput = Schema.Struct({
  threadId: ThreadId,
  /** Always the user's explicit choice; the server never substitutes another reviewer. */
  modelSelection: ModelSelection,
});
export type ThreadReviewStartInput = typeof ThreadReviewStartInput.Type;

export const ThreadReviewStartResult = Schema.Struct({
  /** The side chat of `threadId` the reviewer runs in. */
  reviewThreadId: ThreadId,
});
export type ThreadReviewStartResult = typeof ThreadReviewStartResult.Type;

export class ThreadReviewError extends Schema.TaggedError<ThreadReviewError>()(
  "ThreadReviewError",
  {
    reason: Schema.Literals([
      "thread_not_found",
      "reviewer_unavailable",
      "reviewer_excluded",
      "nothing_to_review",
      "diff_unavailable",
      "start_failed",
    ]),
    message: Schema.String,
  },
) {}
