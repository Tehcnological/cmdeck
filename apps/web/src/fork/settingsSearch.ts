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
    id: "agent-discipline",
    title: msg("Agent discipline"),
    to: "/settings/providers",
    searchTerms: [msg("done-check change log subagents budget review codex gate defaults")],
  },
  {
    id: "agent-subagent-cap",
    title: msg("Subagents at once"),
    to: "/settings/providers",
    searchTerms: [msg("subagent cap budget parallel delegate agents fan out concurrent")],
  },
  {
    id: "agent-review-rounds",
    title: msg("Review rounds"),
    to: "/settings/providers",
    searchTerms: [msg("codex review bot pull request rounds cap loop findings")],
  },
  {
    id: "agent-checkpoints",
    title: msg("Progress reports and stall limit"),
    to: "/settings/providers",
    searchTerms: [msg("checkpoint progress interval minutes stall stop improve done-check")],
  },
  {
    id: "bots",
    title: msg("Bots"),
    to: "/settings/threads",
    searchTerms: [msg("bot persistent agent schedule wake private memory crew")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
