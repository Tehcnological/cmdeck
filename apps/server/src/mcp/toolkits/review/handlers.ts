import { OrchestratorMcpFailure, type ThreadReviewError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ThreadReview from "../../../review/ThreadReview.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { ReviewToolkit } from "./tools.ts";

const failureCodes = {
  thread_not_found: "thread_not_found",
  reviewer_unavailable: "provider_unavailable",
  nothing_to_review: "invalid_request",
  diff_unavailable: "orchestration_error",
  start_failed: "orchestration_error",
} as const;

const reviewFailure = (error: ThreadReviewError) =>
  new OrchestratorMcpFailure({ code: failureCodes[error.reason], message: error.message });

export const layer = McpToolAccess.toLayer(ReviewToolkit, {
  t3_thread_review: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { scope, projection } = yield* readThread(input.threadId);
        const threadReview = yield* ThreadReview.ThreadReview;
        const started = threadReview.start({
          threadId: projection.thread.id,
          modelSelection: { instanceId: input.providerInstanceId, model: input.model },
          requestedBy: "agent",
          instructions: input.instructions,
        });
        const { reviewThreadId } = yield* Effect.mapError(started, reviewFailure);
        return {
          reviewThreadId,
          link: McpInvocationContext.threadLinkFor(scope, reviewThreadId),
          status: "started" as const,
        };
      }),
  ),
});
