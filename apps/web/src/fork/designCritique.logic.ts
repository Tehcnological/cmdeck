import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import type { ComposerThreadTarget } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";

/** Sent to the agent, so it stays English. It names the skill and still works without it. */
export const DESIGN_CRITIQUE_PROMPT = [
  "Critique the design of the page in this thread's preview. Use the design-critique skill if you have it.",
  "Capture it at phone (390px), tablet (768px) and desktop (1280px) widths with preview_resize and preview_snapshot (save: true), and check light and dark with preview_set_appearance.",
  "Measure text contrast, read the accessibility tree for unnamed controls, missing labels and broken heading order, and report the top findings with severity, the three screenshots, and what you could not check.",
  "If I am driving the preview tab, open your own tab on the same page instead of resizing mine. Do not change any files.",
].join(" ");

export interface DesignCritiqueTarget {
  /** Where the prompt goes. */
  readonly composer: ComposerThreadTarget;
  /** Whose right panel must be showing the preview. */
  readonly panel: ScopedThreadRef;
}

/** The thread on screen, or null when no thread or draft is open. */
export function designCritiqueTarget(
  route: ThreadRouteTarget | null,
  draft: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } | null,
): DesignCritiqueTarget | null {
  if (route === null) return null;
  if (route.kind === "server") return { composer: route.threadRef, panel: route.threadRef };
  if (draft === null) return null;
  return { composer: route.draftId, panel: scopeThreadRef(draft.environmentId, draft.threadId) };
}

/** Adds the prompt after the user's draft, once. */
export function withDesignCritiquePrompt(draft: string): string {
  if (draft.includes(DESIGN_CRITIQUE_PROMPT)) return draft;
  const kept = draft.trimEnd();
  return kept.length === 0 ? DESIGN_CRITIQUE_PROMPT : `${kept}\n\n${DESIGN_CRITIQUE_PROMPT}`;
}
