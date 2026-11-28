import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { SandboxMode, SandboxStatus } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { useGT } from "gt-react";
import { BoxIcon } from "lucide-react";
import { createElement } from "react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useAtomCommand } from "../state/use-atom-command";
import { configureSandbox, sandboxStatus } from "./ContainerSandboxSection";
import { type ThreadContainerAction, threadContainerActions } from "./containerSandbox.logic";

const NO_ITEMS: ReadonlyArray<CommandPaletteActionItem> = [];
type StatusAtom = Atom.Atom<AsyncResult.AsyncResult<SandboxStatus, unknown>>;
const NO_STATUS: StatusAtom = Atom.make(AsyncResult.initial<SandboxStatus, unknown>());

const MODE_FOR: Record<ThreadContainerAction, SandboxMode | null> = {
  "run-in-container": "on",
  "run-on-host": "off",
  "follow-project": null,
};

export const commandOrder = 60;

/** Palette rows that move the open thread into or out of a container, once an image is set. */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const { activeThread } = useHandleNewThread();
  const statusAtom: StatusAtom =
    activeThread === null || activeThread === undefined
      ? NO_STATUS
      : sandboxStatus({
          environmentId: activeThread.environmentId,
          input: { threadId: activeThread.id },
        });
  const status = AsyncResult.getOrElse(useAtomValue(statusAtom), () => null);
  const refresh = useAtomRefresh(statusAtom);
  const canChange = useAtomValue(
    configureSandbox.permissionAtom(activeThread?.environmentId ?? null),
  );
  const configure = useAtomCommand(configureSandbox, { reportFailure: false });
  if (activeThread === null || activeThread === undefined || !canChange) return NO_ITEMS;
  const titles: Record<ThreadContainerAction, string> = {
    "run-in-container": gt("Run this thread in a container"),
    "run-on-host": gt("Run this thread on the host"),
    "follow-project": gt("Use this project's container setting for this thread"),
  };
  return threadContainerActions(status).map((action) => ({
    kind: "action",
    value: `action:cmdeck:container:${action}`,
    searchTerms: ["container", "sandbox", "docker", "isolate", "host"],
    title: titles[action],
    icon: createElement(BoxIcon, { className: ITEM_ICON_CLASS }),
    run: async () => {
      const result = await configure({
        environmentId: activeThread.environmentId,
        input: { thread: { threadId: activeThread.id, mode: MODE_FOR[action] } },
      });
      refresh();
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not change the container setting"),
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  }));
}
