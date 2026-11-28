import { msg } from "gt-react";

import type { SettingsSearchItem } from "../../components/settings/settingsSearch";

export const searchOrder = 37;

export const items = [
  {
    id: "telegram",
    title: msg("Telegram"),
    to: "/settings/general",
    searchTerms: [msg("telegram bot chat messaging phone approve remote botfather allowlist")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
