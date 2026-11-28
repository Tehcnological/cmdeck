import * as Modules from "./settingsSearchModules";

type Item = (typeof Modules)[keyof typeof Modules]["items"][number];

/**
 * Fork rows in settings search, spread into upstream's list so their ids type-check there. Each
 * module's search file (listed in `settingsSearchModules.ts`) exports its `items`.
 */
export const FORK_SETTINGS_SEARCH_ITEMS = Object.values(Modules)
  .toSorted((a, b) => a.searchOrder - b.searchOrder)
  .flatMap((module): ReadonlyArray<Item> => module.items);
