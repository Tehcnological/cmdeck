import { msg } from "gt-react";

import type { SettingsSearchItem } from "../../components/settings/settingsSearch";

export const searchOrder = 25;

export const items = [
  {
    id: "knowledge-library",
    title: msg("Knowledge library", { $context: "settings section" }),
    to: "/settings/general",
    searchTerms: [msg("knowledge notes library sources index documents folders search")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
