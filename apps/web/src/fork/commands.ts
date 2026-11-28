import type { CommandPaletteActionItem } from "../components/CommandPalette.logic";
import * as Modules from "./commandModules";

const modules = Object.values(Modules).toSorted((a, b) => a.commandOrder - b.commandOrder);

/**
 * Fork rows in the command palette's root list. Each module's commands file (listed in
 * `commandModules.ts`) exports `useCommandItems`, which returns its rows only while it is on.
 * The list is fixed when the bundle loads, so every render calls the same hooks in the same order.
 */
// oxlint-disable-next-line t3code/no-hookless-use-function -- it calls each module's hook through the list
export function useForkCommandItems(): ReadonlyArray<CommandPaletteActionItem> {
  return modules.flatMap((module) => module.useCommandItems());
}
