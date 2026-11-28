import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { msg, useGT } from "gt-react";

import type { ComposerCommandItem } from "../../components/chat/ComposerCommandMenu";
import { toastManager } from "../../components/ui/toast";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { m } from "../../i18n/messages";
import { useAtomCommand } from "../../state/use-atom-command";
import { parseRememberCommand, REMEMBER_KIND } from "./memoryMode.logic";
import { applyMemoryEdit, rememberMemory } from "./memoryRpc";

const NO_ITEMS: ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>> = [];

/** `/remember` in the composer's slash menu, while memory is on for the environment. */
export function useForkSlashCommandItems(environmentId: EnvironmentId) {
  const gt = useGT();
  const memoryEnabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  if (!memoryEnabled) return NO_ITEMS;
  return [
    {
      id: "slash:remember",
      type: "slash-command",
      command: "remember",
      label: "/remember",
      description: gt("Save a standing rule for this project's threads"),
    },
  ] as const satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
}

/**
 * Takes a `/remember <text>` message instead of sending it: saves the text as the person's own
 * rule for the project and clears the composer once it is saved. Returns whether it took the
 * message. While memory is off, `/remember` is ordinary text.
 */
export function useRememberCommand(environmentId: EnvironmentId) {
  const memoryEnabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  const canUndo = useAtomValue(applyMemoryEdit.permissionAtom(environmentId));
  const remember = useAtomCommand(rememberMemory, { reportFailure: false });
  const retire = useAtomCommand(applyMemoryEdit);

  return (
    prompt: string,
    threadId: ThreadId | null,
    setPrompt: (text: string) => void,
  ): boolean => {
    if (!memoryEnabled) return false;
    const content = parseRememberCommand(prompt);
    if (content === null) return false;
    if (content === "") {
      toastManager.add({ type: "info", title: m(msg("Type what to remember after /remember.")) });
      return true;
    }
    if (threadId === null) {
      toastManager.add({
        type: "info",
        title: m(msg("Send this thread's first message before saving memory from it.")),
      });
      return true;
    }
    void remember({ environmentId, input: { threadId, content, kind: REMEMBER_KIND } }).then(
      (result) => {
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: m(msg("Not remembered")),
            description: error instanceof Error ? error.message : undefined,
          });
          return;
        }
        setPrompt("");
        const item = result.value;
        const id = toastManager.add({
          type: "success",
          title: m(msg("Remembered for this project")),
          description: item.content,
          ...(canUndo
            ? {
                actionProps: {
                  children: m(msg("Undo")),
                  onClick: () => {
                    toastManager.close(id);
                    void retire({
                      environmentId,
                      input: { items: [item], operation: { type: "retire" } },
                    });
                  },
                },
              }
            : {}),
        });
      },
    );
    return true;
  };
}
