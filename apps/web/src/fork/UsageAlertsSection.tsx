import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Input } from "../components/ui/input";
import { useUpdateEnvironmentSettings } from "../hooks/useSettings";
import {
  DEFAULT_USAGE_ALERT_PERCENTS,
  formatUsageAlertPercents,
  parseUsageAlertPercents,
  sameUsageAlertPercents,
} from "./usageAlertPercents.logic";

/** Settings > Providers: usage threshold alerts (WI-2.14), sent through notification channels. */
export function UsageAlertsSection({
  environmentId,
  settings,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly settings: Pick<UnifiedSettings, "cmdeck">;
  readonly readOnly: boolean;
}) {
  const percents = settings.cmdeck.usageAlertPercents;
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const saved = formatUsageAlertPercents(percents);
  const [field, setField] = useState({ saved, draft: saved });
  if (field.saved !== saved) setField({ saved, draft: saved });
  const parsed = parseUsageAlertPercents(field.draft);

  const save = (next: ReadonlyArray<number>) => {
    setField({ saved, draft: formatUsageAlertPercents(next) });
    if (sameUsageAlertPercents(next, percents)) return;
    updateSettings(
      { cmdeck: { usageAlertPercents: [...next] } },
      { onFailed: () => setField({ saved, draft: saved }) },
    );
  };

  return (
    <SettingsSection title={gt("Usage alerts")}>
      <SettingsRow
        {...searchableSetting("usage-alerts")}
        description={
          parsed === null
            ? gt("Enter whole percentages from 1 to 100, separated by commas.")
            : gt(
                "Tell your notification channels once per limit window when an account's usage passes these percentages. Leave empty to turn alerts off. Nothing is sent without an enabled channel.",
              )
        }
        resetAction={
          !readOnly && !sameUsageAlertPercents(percents, DEFAULT_USAGE_ALERT_PERCENTS) ? (
            <SettingResetButton
              ariaLabel={gt("Reset usage alert thresholds to default")}
              onClick={() => save(DEFAULT_USAGE_ALERT_PERCENTS)}
            />
          ) : null
        }
        control={
          <Input
            size="sm"
            className="w-32"
            value={field.draft}
            placeholder={gt("Off")}
            disabled={readOnly}
            aria-invalid={parsed === null}
            aria-label={gt("Usage alert thresholds in percent")}
            onChange={(event) => setField({ saved, draft: event.currentTarget.value })}
            onBlur={() => {
              if (parsed !== null) save(parsed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsed !== null) save(parsed);
              if (event.key === "Escape") setField({ saved, draft: saved });
            }}
          />
        }
      />
    </SettingsSection>
  );
}
