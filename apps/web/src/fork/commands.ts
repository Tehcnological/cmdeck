import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";

const NO_FORK_COMMANDS: ReadonlyArray<CommandPaletteActionItem> = [];

/** Fork rows in the command palette's root list. A module adds its rows here, only while it is on. */
// oxlint-disable-next-line t3code/no-hookless-use-function -- the palette's seam: module rows will read hooks here
export function useForkCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  return NO_FORK_COMMANDS;
}
