import { msg } from "gt-react";

import type { SettingsSearchItem } from "../../components/settings/settingsSearch";

export const searchOrder = 35;

export const items = [
  {
    id: "heartbeat",
    title: msg("Health monitoring"),
    to: "/settings/general",
    searchTerms: [
      msg("heartbeat health monitor probe uptime stalled hung turn linked environment alert"),
    ],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
