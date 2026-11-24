import {
  CHECKPOINT_DIFF_TRUNCATED_MARKER,
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationGetFullThreadDiffResult,
  type RuntimeMode,
  THREAD_REVIEW_TAG,
  ThreadId,
  ThreadReviewError,
  type ThreadReviewStartResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import type { ProjectionCheckpointContext } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "../orchestration-v2/UserFacingErrors.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";

// Most to least restrictive; full access is never offered to a reviewer.
const REVIEWER_RUNTIME_MODES: ReadonlyArray<RuntimeMode> = [
  "approval-required",
  "auto-accept-edits",
  "auto",
];

// The diff rides in the reviewer's first message; past this it is cut and the reviewer is told.
const MAX_REVIEW_DIFF_CHARS = 200_000;

export class ThreadReview extends Context.Service<
  ThreadReview,
  {
    /**
     * Starts a second model reviewing the thread's diff in a side chat of the thread. The
     * reviewer is exactly `modelSelection`; an unusable one fails, never falls back.
     */
    readonly start: (input: {
      readonly threadId: ThreadId;
      readonly modelSelection: ModelSelection;
      readonly requestedBy: "user" | "agent";
    }) => Effect.Effect<ThreadReviewStartResult, ThreadReviewError>;
  }
>()("t3/review/ThreadReview") {}

/** The turn count the diff panel's whole-thread diff ends at: the last completed turn's checkpoint. */
function latestDiffTurnCount(context: ProjectionCheckpointContext): number {
  const completed = new Set(
    context.runs.filter((run) => run.status === "completed").map((run) => run.id),
  );
  return context.checkpoints.reduce(
    (max, checkpoint) =>
      (checkpoint.status === "ready" || checkpoint.status === "missing") &&
      checkpoint.appRunOrdinal !== null &&
      checkpoint.runId !== null &&
      completed.has(checkpoint.runId)
        ? Math.max(max, checkpoint.appRunOrdinal)
        : max,
    0,
  );
}

function reviewPatch(diff: OrchestrationGetFullThreadDiffResult): string {
  return [
    diff.diff,
    ...(diff.repositories ?? []).map(
      (repository) =>
        `# Repository ${repository.name} (${repository.relativePath})\n${repository.diff}`,
    ),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function reviewPrompt(patch: string): string {
  const truncated =
    patch.length > MAX_REVIEW_DIFF_CHARS || patch.includes(CHECKPOINT_DIFF_TRUNCATED_MARKER);
  return [
    "You are a second-model code reviewer. Review the diff below, which another agent produced in this workspace.",
    "Do not edit files, run commands that change anything, or commit. Read files in the workspace only when you need context.",
    "Report concrete findings, most severe first. For each: the file and line, what is wrong, and why it matters. Skip style nits unless they hide a bug. If you find nothing worth fixing, say so plainly.",
    ...(truncated ? ["The diff is truncated; say which parts you could not review."] : []),
    "",
    "```diff",
    patch.slice(0, MAX_REVIEW_DIFF_CHARS),
    "```",
  ].join("\n");
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const diffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const random = yield* SecureRandom.SecureRandom;

  const start: ThreadReview["Service"]["start"] = Effect.fn("ThreadReview.start")(function* (
    input,
  ) {
    yield* Effect.annotateCurrentSpan({
      "thread_review.thread_id": input.threadId,
      "thread_review.instance_id": input.modelSelection.instanceId,
    });
    const reviewer = (yield* providers.getProviders).find(
      (provider) => provider.instanceId === input.modelSelection.instanceId,
    );
    if (reviewer === undefined || !reviewer.enabled) {
      return yield* new ThreadReviewError({
        reason: "reviewer_unavailable",
        message: `Provider instance ${input.modelSelection.instanceId} is not available on this environment.`,
      });
    }
    const runtimeMode = REVIEWER_RUNTIME_MODES.find(
      (mode) =>
        reviewer.supportedRuntimeModes === undefined ||
        reviewer.supportedRuntimeModes.includes(mode),
    );
    if (runtimeMode === undefined) {
      return yield* new ThreadReviewError({
        reason: "reviewer_unavailable",
        message: `Provider instance ${reviewer.instanceId} only runs with full access, which a reviewer never gets.`,
      });
    }

    const threadNotFound = () =>
      new ThreadReviewError({
        reason: "thread_not_found",
        message: `Thread ${input.threadId} was not found.`,
      });
    const parent = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(threadNotFound));
    if (parent === null || parent.deletedAt !== null) return yield* threadNotFound();

    const diffUnavailable = () =>
      new ThreadReviewError({
        reason: "diff_unavailable",
        message: "The thread's diff could not be read.",
      });
    const toTurnCount = latestDiffTurnCount(
      yield* threads.getCheckpointContext(input.threadId).pipe(Effect.mapError(diffUnavailable)),
    );
    const patch =
      toTurnCount === 0
        ? ""
        : reviewPatch(
            yield* diffs
              .getFullThreadDiff({ threadId: input.threadId, toTurnCount })
              .pipe(Effect.mapError(diffUnavailable)),
          );
    if (patch.trim().length === 0) {
      return yield* new ThreadReviewError({
        reason: "nothing_to_review",
        message: "This thread has no changes to review yet.",
      });
    }

    const id = yield* random.uuidV4().pipe(Effect.mapError(() => startFailed(undefined)));
    const reviewThreadId = ThreadId.make(`review:${id}`);
    const command = (step: string) => CommandId.make(`server:thread-review:${id}:${step}`);
    const origin = {
      createdBy: input.requestedBy,
      creationSource: input.requestedBy === "agent" ? ("mcp" as const) : ("web" as const),
    };
    const dispatch = (step: Parameters<typeof threads.dispatch>[0]) =>
      threads.dispatch(step).pipe(Effect.mapError(startFailed));

    // A side chat shares the thread's checkout without snapshotting it; the tag marks it a review.
    yield* dispatch({
      type: "thread.fork",
      ...origin,
      commandId: command("fork"),
      sourceThreadId: input.threadId,
      targetThreadId: reviewThreadId,
      sourcePoint: { type: "latest_stable" },
      sideChat: true,
      title: `Review by ${input.modelSelection.model}`,
    });
    yield* dispatch({
      type: "thread.tag.set",
      commandId: command("tag"),
      threadId: reviewThreadId,
      tag: THREAD_REVIEW_TAG,
      tagged: true,
    });
    yield* dispatch({
      type: "thread.runtime-mode.set",
      commandId: command("runtime-mode"),
      threadId: reviewThreadId,
      runtimeMode,
    });
    // Fresh context: the reviewer judges the diff, not the conversation that produced it.
    yield* dispatch({
      type: "message.dispatch",
      ...origin,
      commandId: command("message"),
      threadId: reviewThreadId,
      messageId: MessageId.make(`message:thread-review:${id}`),
      text: reviewPrompt(patch),
      attachments: [],
      modelSelection: input.modelSelection,
      freshContext: true,
      dispatchMode: { type: "start_immediately" },
    });
    return { reviewThreadId };
  });

  return ThreadReview.of({ start });
});

function startFailed(cause: unknown) {
  return new ThreadReviewError({
    reason: "start_failed",
    message: userFacingDispatchErrorMessage(cause) ?? "The review could not be started.",
  });
}

export const layer = Layer.effect(ThreadReview, make);
