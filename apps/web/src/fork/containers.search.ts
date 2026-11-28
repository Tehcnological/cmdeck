import { msg } from "gt-react";

import type { SettingsSearchItem } from "../components/settings/settingsSearch";

export const searchOrder = 60;

export const items = [
  {
    id: "containers",
    title: msg("Containers"),
    to: "/settings/general",
    searchTerms: [msg("sandbox docker gvisor isolation network mounts")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;
