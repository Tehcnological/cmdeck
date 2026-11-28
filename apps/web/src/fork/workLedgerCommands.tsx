import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ListChecksIcon, WorkflowIcon } from "lucide-react";

import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../components/CommandPalette.logic";
import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useAtomCommand } from "../state/use-atom-command";
import { openForkPanel } from "./panels";
import { setConductor } from "./workLedger";
import { type WorkLedgerCommandRow, workLedgerCommandRows } from "./workLedger.logic";

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

export const commandOrder = 50;

/** Start conductor and Open work ledger for the open thread or new-thread draft (WI-2.02). */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const threadRef = useRouteThreadRef();
  const startConductor = useAtomCommand(setConductor, { reportFailure: false });
  const canChangeConductor = useAtomValue(
    setConductor.permissionAtom(threadRef?.environmentId ?? ("" as EnvironmentId)),
  );
  const rows = workLedgerCommandRows({ hasThread: threadRef !== null, canChangeConductor });
  if (threadRef === null || rows.length === 0) return NO_COMMANDS;
  const openLedger = () => openForkPanel(threadRef, "work-ledger");
  const items: Record<WorkLedgerCommandRow, CommandPaletteActionItem> = {
    "start-conductor": {
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
    "open-work-ledger": {
      kind: "action",
      value: "action:cmdeck-open-work-ledger",
      searchTerms: ["work ledger", "work items", "conductor", "workers"],
      title: gt("Open work ledger"),
      icon: <ListChecksIcon className={ITEM_ICON_CLASS} />,
      run: async () => openLedger(),
    },
  };
  return rows.map((row) => items[row]);
}
