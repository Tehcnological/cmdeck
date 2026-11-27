import type { ProviderInstanceEnvironmentVariable } from "@t3tools/contracts";

import type { ManagedInstanceLocks } from "../state/managedPolicy";

const variable = (name: string, value = ""): ProviderInstanceEnvironmentVariable => ({
  name,
  value,
  sensitive: false,
});

/** Claude Code's own Bedrock settings: a profile name and region, never AWS keys. */
export const BEDROCK_PRESET_ENVIRONMENT: ReadonlyArray<ProviderInstanceEnvironmentVariable> = [
  variable("CLAUDE_CODE_USE_BEDROCK", "1"),
  variable("AWS_PROFILE"),
  variable("AWS_REGION"),
  variable("ANTHROPIC_DEFAULT_OPUS_MODEL"),
  variable("ANTHROPIC_DEFAULT_SONNET_MODEL"),
  variable("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
];

const PRESET_NAMES = new Set(BEDROCK_PRESET_ENVIRONMENT.map((entry) => entry.name));

/** Preset rows left empty are dropped, so Claude Code falls back to its own default for each. */
export const bedrockEnvironmentForSave = (
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
) => environment.filter((entry) => !(PRESET_NAMES.has(entry.name) && entry.value === ""));

/** A policy that pins any variable the preset writes owns the instance's environment. */
export const bedrockPresetAllowed = (locks: ManagedInstanceLocks | undefined) =>
  locks === undefined ||
  (!locks.wholeEnvironment && ![...PRESET_NAMES].some((name) => locks.environmentNames.has(name)));
