import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { type ScopedThreadRef, type ServerProvider, THREAD_REVIEW_TAG } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react";
import { ScanSearchIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";
import { environmentThreadShells, threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

const EMPTY_REVIEWS: ReadonlyArray<EnvironmentThreadShell> = [];
const NO_REVIEWS_ATOM = Atom.make(EMPTY_REVIEWS);

// A thread's review side chats. Quiet shells keep status changes but skip streaming ticks.
const threadReviewsAtom = Atom.family((key: string) => {
  const parentRef = parseScopedThreadKey(key);
  return Atom.make((get) => {
    if (parentRef === null) return EMPTY_REVIEWS;
    const reviews = get(environmentThreadShells.sideChatsAtom(parentRef)).flatMap((sideChat) => {
      const shell = get(
        environmentThreadShells.quietThreadShellAtom(
          scopeThreadRef(parentRef.environmentId, sideChat.id),
        ),
      );
      return shell !== null &&
        shell.archivedAt === null &&
        shell.deletedAt === null &&
        shell.source.tags?.includes(THREAD_REVIEW_TAG) === true
        ? [shell]
        : [];
    });
    return reviews.length === 0 ? EMPTY_REVIEWS : reviews;
  }).pipe(Atom.withLabel(`chat:thread-reviews:${key}`));
});

type ReviewState = "running" | "approval" | "ready" | "failed" | "stopped";

function reviewState(review: EnvironmentThreadShell): ReviewState {
  switch (review.source.status) {
    case "completed":
      return "ready";
    case "failed":
      return "failed";
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return "stopped";
    default:
      return review.hasPendingApprovals ? "approval" : "running";
  }
}

/**
 * Second-model reviews of `threadRef`, one notice each, attributed to the reviewer. Findings stay
 * in the review's side chat until the user sends them to this thread's agent.
 */
export function useThreadReviewBannerItems(
  threadRef: ScopedThreadRef | null,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ComposerBannerStackItem> {
  const gt = useGT();
  const reviews = useAtomValue(
    threadRef === null ? NO_REVIEWS_ATOM : threadReviewsAtom(scopedThreadKey(threadRef)),
  );
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn);
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack);
  const deleteThread = useAtomCommand(threadEnvironment.delete);
  if (threadRef === null || reviews.length === 0) return [];

  const statusLabel: Record<ReviewState, string> = {
    running: gt("Reviewing the changes…"),
    approval: gt("The reviewer is waiting for your approval."),
    ready: gt("Findings are ready."),
    failed: gt("The review failed."),
    stopped: gt("The review was stopped."),
  };

  return reviews.map((review): ComposerBannerStackItem => {
    const state = reviewState(review);
    const provider = providers.find(
      (candidate) => candidate.instanceId === review.modelSelection.instanceId,
    );
    const latestRunId = review.source.latestRunId;
    const settled = state === "ready" || state === "failed" || state === "stopped";
    const open = () => useRightPanelStore.getState().openThread(threadRef, review.id);
    return {
      id: `thread-review:${review.id}`,
      variant: state === "failed" ? "error" : "info",
      icon: <ScanSearchIcon />,
      title: gt("Review by {provider} · {model}", {
        provider: provider?.displayName ?? provider?.driver ?? review.modelSelection.instanceId,
        model: review.modelSelection.model,
      }),
      description:
        state === "failed" && review.source.lastError
          ? review.source.lastError
          : statusLabel[state],
      actions: (
        <>
          <Button size="xs" variant="ghost" onClick={open}>
            {state === "ready" ? gt("Read findings") : gt("Open")}
          </Button>
          {settled ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void interruptTurn({
                  environmentId: threadRef.environmentId,
                  input: { threadId: review.id },
                })
              }
            >
              {gt("Stop", { $context: "verb, stops a running review" })}
            </Button>
          )}
          {state === "ready" && latestRunId !== null ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void mergeBack({
                  environmentId: threadRef.environmentId,
                  input: {
                    sourceThreadId: review.id,
                    targetThreadId: threadRef.threadId,
                    runId: latestRunId,
                  },
                })
              }
            >
              {gt("Send to agent")}
            </Button>
          ) : null}
        </>
      ),
      ...(settled
        ? {
            dismissLabel: gt("Discard review"),
            onDismiss: () =>
              void deleteThread({
                environmentId: threadRef.environmentId,
                input: { threadId: review.id },
              }),
          }
        : {}),
    };
  });
}
