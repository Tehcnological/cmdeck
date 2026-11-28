import { msg } from "gt-react";

import type { SettingsSearchItem } from "../../components/settings/settingsSearch";

export const searchOrder = 20;

export const items = [
  {
    id: "memory",
    title: msg("Memory", { $context: "what CMDeck remembers for agents" }),
    to: "/settings/memory",
    searchTerms: [msg("remember incognito temporary proposals rules facts revisions")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
