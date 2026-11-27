import type { EnvironmentId, ProviderInstanceEnvironmentVariable } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { ProviderEnvironmentSection } from "../components/settings/ProviderInstanceCard";
import type { SecretSource } from "../components/settings/SecretSourceInput";
import { SettingsRow } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import type { ManagedInstanceLocks } from "../state/managedPolicy";
import { BEDROCK_PRESET_ENVIRONMENT, bedrockPresetAllowed } from "./bedrockPreset";

export function BedrockPresetSection(props: {
  readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly onChange: (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => void;
  readonly locks: ManagedInstanceLocks | undefined;
  readonly secretSources: ReadonlyArray<SecretSource>;
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  if (!bedrockPresetAllowed(props.locks)) return null;
  if (props.environment.length === 0) {
    return (
      <SettingsRow
        // oxlint-disable-next-line t3code/no-untranslated-copy -- product name stays English
        title="Amazon Bedrock"
        description={gt("Run Claude through a named AWS profile. AWS keys are never stored.")}
        control={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onChange(BEDROCK_PRESET_ENVIRONMENT)}
          >
            <T>Use Amazon Bedrock</T>
          </Button>
        }
      />
    );
  }
  return (
    <>
      <p className="pt-3 text-xs text-muted-foreground">
        <T>Enter your AWS profile and region. Leave a model empty to use Claude Code's default.</T>
      </p>
      <ProviderEnvironmentSection
        environment={props.environment}
        onChange={props.onChange}
        secretSources={props.secretSources}
        environmentId={props.environmentId}
      />
    </>
  );
}
