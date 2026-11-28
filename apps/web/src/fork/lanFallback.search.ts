import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

export const searchOrder = 36;

export const items = [
  {
    id: "lan-fallback",
    title: msg("LAN fallback"),
    to: "/settings/general",
    searchTerms: [
      msg("lan local network fallback backup route tailscale offline https certificate"),
    ],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
