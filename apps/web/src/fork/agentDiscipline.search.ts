import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

export const searchOrder = 40;

export const items = [
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
] as const satisfies ReadonlyArray<SettingsSearchItem>;
