import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, ThreadMemoryMode } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  BrainIcon,
  EyeOffIcon,
  GhostIcon,
  HistoryIcon,
  SettingsIcon,
  Undo2Icon,
} from "lucide-react";

import { ComposerControl, ComposerControlIcon } from "../../components/chat/ComposerControl";
import { useComposerMenuProps } from "../../components/chat/composerEventScope";
import { useComposerMenuState } from "../../components/chat/useComposerMenuState";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { openForkPanel } from "../panels";
import { memoryModeChip } from "./memoryMode.logic";
import { setThreadMemoryMode, threadMemoryMode } from "./memoryRpc";

const MODE_ICONS = {
  persistent: BrainIcon,
  incognito: EyeOffIcon,
  temporary: GhostIcon,
} as const;

/**
 * The composer's memory-mode chip (WI-2.05). Shown only while memory is on and the thread exists
 * on the server, which holds its mode.
 */
export function MemoryModeChip(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly isServerThread: boolean;
}) {
  const memoryEnabled = useEnvironmentSettings(
    props.environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  if (!memoryEnabled || !props.isServerThread) return null;
  return <MemoryModeMenu environmentId={props.environmentId} threadId={props.threadId} />;
}

function MemoryModeMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId, threadId } = props;
  const query = useEnvironmentQuery(threadMemoryMode({ environmentId, input: { threadId } }));
  const canChange = useAtomValue(setThreadMemoryMode.permissionAtom(environmentId));
  const setMode = useAtomCommand(setThreadMemoryMode);
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(false);
  const mode = query.data?.mode ?? "persistent";
  const chip = memoryModeChip(mode);
  const labels = {
    persistent: gt("Persistent", { $context: "memory mode" }),
    incognito: gt("Incognito", { $context: "memory mode" }),
    temporary: gt("Temporary", { $context: "memory mode" }),
  } satisfies Record<ThreadMemoryMode, string>;
  const descriptions = {
    persistent: gt("Uses saved memory and can save what you ask it to remember."),
    incognito: gt("Uses saved memory but saves nothing new from this thread."),
    temporary: gt("Uses no saved memory and saves nothing from this thread."),
  } satisfies Record<ThreadMemoryMode, string>;

  const change = async (next: ThreadMemoryMode) => {
    if (next === mode) return;
    await setMode({ environmentId, input: { threadId, mode: next } });
    query.refresh();
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  size="xs"
                  aria-label={gt("Memory: {mode}", { mode: labels[mode] })}
                />
              }
            />
          }
        >
          <ComposerControlIcon icon={MODE_ICONS[mode]} size="xs" />
          {chip.showLabel ? <span data-composer-control-label>{labels[mode]}</span> : null}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {gt("Memory: {mode}. {description}", {
            mode: labels[mode],
            description: descriptions[mode],
          })}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" className="w-80" {...composerFloatingLayerProps}>
        <MenuGroup>
          <MenuGroupLabel>
            <T>Memory for this thread</T>
          </MenuGroupLabel>
          {chip.canPromote ? (
            <MenuItem disabled={!canChange} onClick={() => void change("persistent")}>
              <Undo2Icon />
              <T>Promote to persistent</T>
            </MenuItem>
          ) : null}
          <MenuRadioGroup
            value={mode}
            onValueChange={(next: ThreadMemoryMode) => void change(next)}
          >
            {(["persistent", "incognito", "temporary"] as const).map((option) => {
              const Icon = MODE_ICONS[option];
              return (
                <MenuRadioItem key={option} value={option} disabled={!canChange}>
                  <span className="flex items-start gap-2 py-0.5">
                    <Icon className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span>{labels[option]}</span>
                      <span className="text-muted-foreground text-xs">{descriptions[option]}</span>
                    </span>
                  </span>
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        </MenuGroup>
        <p className="px-2 py-1.5 text-muted-foreground text-xs">
          <T>
            Memory kept by the provider itself, such as Claude Code project memory or Codex
            memories, is outside CMDeck&apos;s control and follows the provider&apos;s own settings.
          </T>
        </p>
        <MenuSeparator />
        <MenuItem onClick={() => openForkPanel(scopeThreadRef(environmentId, threadId), "memory")}>
          <HistoryIcon />
          <T>Memory used here</T>
        </MenuItem>
        <MenuItem onClick={() => void navigate({ to: "/settings/memory" })}>
          <SettingsIcon />
          <T>Memory settings</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
