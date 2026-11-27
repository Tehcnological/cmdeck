import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

/** Fork rows in settings search, spread into upstream's list so their ids type-check there. */
export const FORK_SETTINGS_SEARCH_ITEMS = [
  {
    id: "default-thread-environment",
    title: msg("Default environment"),
    to: "/settings/threads",
    searchTerms: [msg("new threads machine server host start remote local")],
  },
  {
    id: "memory",
    title: msg("Memory", { $context: "what CMDeck remembers for agents" }),
    to: "/settings/memory",
    searchTerms: [msg("remember incognito temporary proposals rules facts revisions")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
