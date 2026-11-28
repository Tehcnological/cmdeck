import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { useGT } from "gt-react";
import { FlaskConicalIcon, ListChecksIcon } from "lucide-react";
import { createElement } from "react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";
import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useWorkflowEnvironmentIds } from "../components/workflows/useWorkflowEnvironmentIds";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";
import { usePrimaryEnvironmentId } from "../state/environments";
import { workflowEnvironmentFor } from "./commands.logic";

const installPreset = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:workflow-preset-install",
  tag: CMDECK_WS_METHODS.workflowPresetInstall,
});

export const commandOrder = 20;

/** Rows that add a bundled workflow preset, for clients that may install one. */
export function useCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  const gt = useGT();
  const navigate = useNavigate();
  const environmentId = workflowEnvironmentFor(
    usePrimaryEnvironmentId(),
    useWorkflowEnvironmentIds(),
  );
  const canInstall = useAtomValue(installPreset.permissionAtom(environmentId));
  const install = useAtomCommand(installPreset, { reportFailure: false });
  if (environmentId === null || !canInstall) return [];
  const presetRow = (
    target: EnvironmentId,
    preset: {
      readonly id: string;
      readonly title: string;
      readonly failure: string;
      readonly icon: typeof ListChecksIcon;
      readonly searchTerms: ReadonlyArray<string>;
    },
  ): CommandPaletteActionItem => ({
    kind: "action",
    value: `action:cmdeck:${preset.id}`,
    searchTerms: [...preset.searchTerms, "workflow", "preset"],
    title: preset.title,
    icon: createElement(preset.icon, { className: ITEM_ICON_CLASS }),
    run: async () => {
      const result = await install({ environmentId: target, input: { id: preset.id } });
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: preset.failure,
            description: error instanceof Error ? error.message : String(error),
          }),
        );
        return;
      }
      await navigate({
        to: "/workflows",
        search: { env: target, file: `${preset.id}.ts` },
      });
    },
  });
  return [
    presetRow(environmentId, {
      id: "task-runner",
      title: gt("Add the Task Runner workflow"),
      failure: gt("Could not add the Task Runner"),
      icon: ListChecksIcon,
      searchTerms: ["task runner", "spec builder", "spec", "plan", "tasks"],
    }),
    presetRow(environmentId, {
      id: "research-lab",
      title: gt("Add the Research Lab workflow"),
      failure: gt("Could not add the Research Lab"),
      icon: FlaskConicalIcon,
      searchTerms: ["research lab", "research", "investigate", "report", "questions"],
    }),
    presetRow(environmentId, {
      id: "code-review",
      title: gt("Add the Code Review workflow"),
      failure: gt("Could not add the Code Review workflow"),
      icon: PullRequestGlyph.pullRequest,
      searchTerms: ["code review", "review", "pull request", "sage", "risk"],
    }),
  ];
}
