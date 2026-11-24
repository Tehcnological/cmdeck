import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

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
      "nothing_to_review",
      "diff_unavailable",
      "start_failed",
    ]),
    message: Schema.String,
  },
) {}
