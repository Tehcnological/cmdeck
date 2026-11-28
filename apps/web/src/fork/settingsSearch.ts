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
  {
    id: "usage-alerts",
    title: msg("Alert thresholds"),
    to: "/settings/providers",
    searchTerms: [msg("usage limit quota percent threshold notify notification channel warning")],
  },
  {
    id: "bots",
    title: msg("Bots"),
    to: "/settings/threads",
    searchTerms: [msg("bot persistent agent schedule wake private memory crew")],
  },
  {
    id: "containers",
    title: msg("Containers"),
    to: "/settings/general",
    searchTerms: [msg("sandbox docker gvisor isolation network mounts")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
