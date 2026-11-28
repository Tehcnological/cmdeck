import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

export const searchOrder = 50;

export const items = [
  {
    id: "bots",
    title: msg("Bots"),
    to: "/settings/threads",
    searchTerms: [msg("bot persistent agent schedule wake private memory crew")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
