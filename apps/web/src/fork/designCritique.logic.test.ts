import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "../composerDraftStore";
import {
  DESIGN_CRITIQUE_PROMPT,
  designCritiqueTarget,
  withDesignCritiquePrompt,
} from "./designCritique.logic";

const environmentId = EnvironmentId.make("env-1");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));

describe("Critique this preview", () => {
  it("asks for the three widths, both appearances, contrast and the accessibility tree", () => {
    for (const text of [
      "design-critique",
      "390px",
      "768px",
      "1280px",
      "preview_resize",
      "preview_snapshot",
      "preview_set_appearance",
      "contrast",
      "accessibility tree",
    ]) {
      expect(DESIGN_CRITIQUE_PROMPT).toContain(text);
    }
  });

  it("targets a sent thread's own composer and panel", () => {
    expect(designCritiqueTarget({ kind: "server", threadRef }, null)).toEqual({
      composer: threadRef,
      panel: threadRef,
    });
  });

  it("targets a draft's composer and the panel of the thread it will become", () => {
    const draftId = DraftId.make("draft-1");
    expect(
      designCritiqueTarget(
        { kind: "draft", draftId },
        { environmentId, threadId: ThreadId.make("thread-2") },
      ),
    ).toEqual({
      composer: draftId,
      panel: scopeThreadRef(environmentId, ThreadId.make("thread-2")),
    });
  });

  it("has no target without a thread on screen or a known draft", () => {
    expect(designCritiqueTarget(null, null)).toBeNull();
    expect(designCritiqueTarget({ kind: "draft", draftId: DraftId.make("gone") }, null)).toBeNull();
  });

  it("fills an empty draft, keeps the user's words ahead of it, and adds it once", () => {
    expect(withDesignCritiquePrompt("")).toBe(DESIGN_CRITIQUE_PROMPT);
    expect(withDesignCritiquePrompt("  \n")).toBe(DESIGN_CRITIQUE_PROMPT);
    const withNote = withDesignCritiquePrompt("Focus on the pricing table.\n");
    expect(withNote).toBe(`Focus on the pricing table.\n\n${DESIGN_CRITIQUE_PROMPT}`);
    expect(withDesignCritiquePrompt(withNote)).toBe(withNote);
  });
});
