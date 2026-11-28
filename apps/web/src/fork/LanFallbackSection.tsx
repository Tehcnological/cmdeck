import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Switch } from "../components/ui/switch";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../hooks/useSettings";
import { serverEnvironment } from "../state/server";

/** Settings > General: LAN fallback, a pinned HTTPS backup route on this machine's LAN. */
export function LanFallbackSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <LanFallbackToggle key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function LanFallbackToggle({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const enabled = useEnvironmentSettings(environmentId, (settings) => settings.cmdeck.lanFallback);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const updateSettings = useUpdateEnvironmentSettings(environmentId);

  return (
    <SettingsSection id="lan-fallback" title={gt("LAN fallback")}>
      <SettingsRow
        {...searchableSetting("lan-fallback")}
        title={gt("Allow LAN fallback")}
        description={gt(
          "Also serves this environment over encrypted HTTPS on its local network addresses, so a desktop app paired over Tailscale keeps working on the same network while Tailscale is off. The desktop app trusts only this environment's own certificate. While this is off, nothing listens on the local network.",
        )}
        control={
          <Switch
            checked={enabled}
            disabled={!canWrite}
            aria-label={gt("Allow LAN fallback")}
            onCheckedChange={(lanFallback) => updateSettings({ cmdeck: { lanFallback } })}
          />
        }
      />
    </SettingsSection>
  );
}

export const settingsSection = {
  page: "general",
  order: 23,
  Component: LanFallbackSection,
} as const;
