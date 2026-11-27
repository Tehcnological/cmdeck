import { msg, useGT } from "gt-react";
import { ScanEyeIcon } from "lucide-react";

import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { m } from "../i18n/messages";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { designCritiqueTarget, withDesignCritiquePrompt } from "./designCritique.logic";

/** "Critique this preview": shown while the thread on screen shows its browser preview. */
export function useDesignCritiqueCommandItem(): CommandPaletteActionItem | null {
  const gt = useGT();
  const route = useThreadRouteTarget();
  const draft = useComposerDraftStore((store) =>
    route?.kind === "draft" ? store.getDraftSession(route.draftId) : null,
  );
  const target = designCritiqueTarget(route, draft);
  const previewShowing = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, target?.panel ?? null) === "preview",
  );
  if (target === null || !previewShowing) return null;
  return {
    kind: "action",
    value: "action:fork:critique-preview",
    searchTerms: [
      "critique",
      "design review",
      "accessibility",
      "contrast",
      "responsive",
      "preview",
    ],
    title: gt("Critique this preview"),
    description: gt("Ask the agent for a design review at three widths"),
    icon: <ScanEyeIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      const store = useComposerDraftStore.getState();
      const prompt = store.getComposerDraft(target.composer)?.prompt ?? "";
      store.setPrompt(target.composer, withDesignCritiquePrompt(prompt));
      toastManager.add({
        type: "info",
        title: m(msg("Critique prompt added")),
        description: m(msg("Read it, then send it to start the review.")),
      });
    },
  };
}
