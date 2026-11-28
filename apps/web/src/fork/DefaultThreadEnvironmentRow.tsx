import { EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { useSearchableSetting } from "../components/settings/settingsSearch";
import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useEnvironmentIdentities } from "../state/environments";
import { useDefaultThreadEnvironmentId } from "./defaultThreadEnvironment";

const AUTOMATIC = "automatic";

export function DefaultThreadEnvironmentRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const identities = useEnvironmentIdentities();
  const [environmentId, setEnvironmentId] = useDefaultThreadEnvironmentId();
  // One machine leaves nothing to choose.
  if (identities.length < 2 && environmentId === null) return null;
  const selected = identities.find((identity) => identity.environmentId === environmentId);

  return (
    <SettingsRow
      {...searchableSetting("default-thread-environment")}
      devicePreference
      description={gt(
        "Where new threads start when their project is on that machine. While it is offline, they start on the current one.",
      )}
      resetAction={
        environmentId !== null ? (
          <SettingResetButton
            ariaLabel={gt("Reset default environment to automatic")}
            onClick={() => setEnvironmentId(null)}
          />
        ) : null
      }
      control={
        <Select
          value={environmentId ?? AUTOMATIC}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            setEnvironmentId(value === AUTOMATIC ? null : EnvironmentId.make(value));
          }}
        >
          <SelectTrigger size="sm" aria-label={gt("Default environment")}>
            <SelectValue>
              {(value: string | null) =>
                value === null || value === AUTOMATIC ? (
                  <T>Automatic</T>
                ) : (
                  (selected?.label ?? gt("Removed", { $context: "a saved environment is gone" }))
                )
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value={AUTOMATIC}>
              <T>Automatic</T>
            </SelectItem>
            {identities.map((identity) => (
              <SelectItem key={identity.environmentId} value={identity.environmentId}>
                {identity.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
