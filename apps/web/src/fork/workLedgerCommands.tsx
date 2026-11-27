import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ListChecksIcon, WorkflowIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useRightPanelStore } from "../rightPanelStore";
import { useAtomCommand } from "../state/use-atom-command";
import { setConductor } from "./workLedger";

const NO_COMMANDS: ReadonlyArray<CommandPaletteActionItem> = [];

/** The open thread, or the thread a new-thread draft becomes once it is sent. */
function useRouteThreadRef(): ScopedThreadRef | null {
  const target = useThreadRouteTarget();
  const draft = useComposerDraftStore((store) =>
    target?.kind === "draft" ? store.getDraftSession(target.draftId) : null,
  );
  if (target?.kind === "server") return target.threadRef;
  return draft === null ? null : scopeThreadRef(draft.environmentId, draft.threadId);
}

/** Start conductor and Open work ledger for the open thread or new-thread draft (WI-2.02). */
export function useWorkLedgerCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const threadRef = useRouteThreadRef();
  const startConductor = useAtomCommand(setConductor, { reportFailure: false });
  if (threadRef === null) return NO_COMMANDS;
  const openLedger = () => useRightPanelStore.getState().openCmdeck(threadRef, "work-ledger");
  return [
    {
      kind: "action",
      value: "action:cmdeck-start-conductor",
      searchTerms: ["conductor", "conduct", "orchestrate", "work ledger", "workers", "delegate"],
      title: gt("Start conductor"),
      description: gt(
        "This thread plans a goal, starts a worker per item, and checks their reports",
      ),
      icon: <WorkflowIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const result = await startConductor({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, conductor: true },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        openLedger();
        toastManager.add({
          type: "success",
          title: gt("This thread is now a conductor"),
          description: gt("Tell it the goal. Its work items show in the Work ledger tab."),
        });
      },
    },
    {
      kind: "action",
      value: "action:cmdeck-open-work-ledger",
      searchTerms: ["work ledger", "work items", "conductor", "workers"],
      title: gt("Open work ledger"),
      icon: <ListChecksIcon className={ITEM_ICON_CLASS} />,
      run: async () => openLedger(),
    },
  ];
}
