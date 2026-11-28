import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

export const searchOrder = 30;

export const items = [
  {
    id: "usage-alerts",
    title: msg("Alert thresholds"),
    to: "/settings/providers",
    searchTerms: [msg("usage limit quota percent threshold notify notification channel warning")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
