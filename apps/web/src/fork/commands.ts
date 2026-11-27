import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { useGT } from "gt-react";
import { ListChecksIcon } from "lucide-react";
import { createElement } from "react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useWorkflowEnvironmentIds } from "../components/workflows/useWorkflowEnvironmentIds";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { usePrimaryEnvironmentId } from "../state/environments";
import { workflowEnvironmentFor } from "./commands.logic";
import { useContainerCommandItems } from "./containerCommands";

const NO_FORK_COMMANDS: ReadonlyArray<CommandPaletteActionItem> = [];

const installPreset = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:workflow-preset-install",
  tag: CMDECK_WS_METHODS.workflowPresetInstall,
});

/** Fork rows in the command palette's root list. A module adds its rows here, only while it is on. */
export function useForkCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const navigate = useNavigate();
  const environmentId = workflowEnvironmentFor(
    usePrimaryEnvironmentId(),
    useWorkflowEnvironmentIds(),
  );
  const canInstall = useAtomValue(installPreset.permissionAtom(environmentId));
  const install = useAtomCommand(installPreset, { reportFailure: false });
  const containerItems = useContainerCommandItems();
  if (environmentId === null || !canInstall) {
    return containerItems.length === 0 ? NO_FORK_COMMANDS : containerItems;
  }
  return [
    ...containerItems,
    {
      kind: "action",
      value: "action:cmdeck:task-runner",
      searchTerms: ["task runner", "spec builder", "spec", "plan", "tasks", "workflow", "preset"],
      title: gt("Add the Task Runner workflow"),
      icon: createElement(ListChecksIcon, { className: ITEM_ICON_CLASS }),
      run: async () => {
        const result = await install({ environmentId, input: { id: "task-runner" } });
        if (result._tag === "Failure") {
          const error = Cause.squash(result.cause);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Could not add the Task Runner"),
              description: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
        await navigate({
          to: "/workflows",
          search: { env: environmentId, file: "task-runner.ts" },
        });
      },
    },
  ];
}
