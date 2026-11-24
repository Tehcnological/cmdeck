import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg, T, useGT } from "gt-react";
import { MessageCircle } from "lucide-react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { m } from "~/i18n/messages";
import type { ReviewCommentContext } from "~/reviewCommentContext";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

/** Line comments wait in the thread's composer draft; this sends or clears them together. */
export function DiffCommentBatchBar({
  composerDraftTarget,
}: {
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const gt = useGT();
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const setReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const requestSubmit = useComposerDraftStore((store) => store.requestSubmit);
  // Pull request chips share the list but are references, not line comments.
  const lineComments = reviewComments.filter((comment) => comment.pullRequest === undefined);
  if (lineComments.length === 0) return null;

  const send = () => {
    if (requestSubmit(composerDraftTarget)) return;
    toastManager.add({
      type: "info",
      title: m(msg("The comments are in the composer. Send them from there.")),
    });
  };

  return (
    <div
      data-diff-comment-batch
      className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-muted/40 px-3 py-1.5"
    >
      <MessageCircle className="size-3.5 shrink-0 text-primary/70" aria-hidden="true" />
      <span className="mr-auto text-xs text-muted-foreground tabular-nums">
        {gt("{count, plural, one {{count} comment} other {{count} comments}}", {
          count: lineComments.length,
        })}
      </span>
      <Button
        variant="ghost-muted"
        size="xs"
        onClick={() =>
          setReviewComments(
            composerDraftTarget,
            reviewComments.filter((comment) => comment.pullRequest !== undefined),
          )
        }
      >
        <T context="verb, removes the pending diff comments">Clear</T>
      </Button>
      <Button size="xs" onClick={send}>
        <T>Send</T>
      </Button>
    </div>
  );
}
