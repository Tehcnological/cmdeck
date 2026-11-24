import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import { toastManager } from "../ui/toast";
import { DiffCommentBatchBar } from "./DiffCommentBatchBar";

const target = DraftId.make("diff-comment-batch-test");

function lineComment(id: string, text: string) {
  return buildFileReviewComment({
    id,
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 1,
    text,
    contents: "const a = 1;\n",
  });
}

const pullRequestChip: ReviewCommentContext = {
  ...lineComment("pull-request", ""),
  pullRequest: {
    number: 7,
    title: "Add a",
    url: "https://example.test/pull/7",
    headBranch: "feature",
    baseBranch: "main",
    state: "open",
    isDraft: false,
  },
};

function setup(): Disposable {
  const reset = () => useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  reset();
  const store = useComposerDraftStore.getState();
  store.addReviewComment(target, pullRequestChip);
  store.addReviewComment(target, lineComment("first", "Rename this"));
  store.addReviewComment(target, lineComment("second", "Handle null"));
  return { [Symbol.dispose]: reset };
}

function button(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

const commentIds = () =>
  (useComposerDraftStore.getState().getComposerDraft(target)?.reviewComments ?? []).map(
    (comment) => comment.id,
  );

describe("DiffCommentBatchBar", () => {
  it("counts line comments and clears them without dropping pull request chips", async () => {
    using _drafts = setup();
    const container = document.createElement("div");
    await using _screen = await render(<DiffCommentBatchBar composerDraftTarget={target} />, {
      container,
    });
    expect(container.textContent).toContain("2 comments");

    await act(() => button(container, "Clear").click());
    expect(commentIds()).toEqual(["pull-request"]);
    expect(container.querySelector("[data-diff-comment-batch]")).toBeNull();
  });

  it("sends through the mounted composer, and points there when none is mounted", async () => {
    using _drafts = setup();
    using toast = vi.spyOn(toastManager, "add");
    const container = document.createElement("div");
    await using _screen = await render(<DiffCommentBatchBar composerDraftTarget={target} />, {
      container,
    });

    await act(() => button(container, "Send").click());
    expect(toast).toHaveBeenCalledTimes(1);

    const submit = vi.fn(() => true);
    const unregister = useComposerDraftStore.getState().setSubmitHandler(target, submit);
    await act(() => button(container, "Send").click());
    expect(submit).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    unregister?.();
    expect(useComposerDraftStore.getState().requestSubmit(target)).toBe(false);
  });
});
