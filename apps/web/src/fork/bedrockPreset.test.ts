import { describe, expect, it } from "vite-plus/test";

import {
  BEDROCK_PRESET_ENVIRONMENT,
  bedrockEnvironmentForSave,
  bedrockPresetAllowed,
} from "./bedrockPreset";

const locks = (names: ReadonlyArray<string>, wholeEnvironment = false) => ({
  configKeys: new Set<string>(),
  environmentNames: new Set(names),
  wholeEnvironment,
  reason: "Managed by Example.",
});

describe("Amazon Bedrock preset", () => {
  it("fills Claude Code's Bedrock variables with a profile name and no AWS keys", () => {
    expect(BEDROCK_PRESET_ENVIRONMENT.map((entry) => entry.name)).toEqual([
      "CLAUDE_CODE_USE_BEDROCK",
      "AWS_PROFILE",
      "AWS_REGION",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]);
    expect(BEDROCK_PRESET_ENVIRONMENT.every((entry) => !entry.sensitive)).toBe(true);
  });

  it("saves what the user filled in, drops empty preset rows and keeps the user's own rows", () => {
    const saved = bedrockEnvironmentForSave([
      ...BEDROCK_PRESET_ENVIRONMENT.map((entry) =>
        entry.name === "AWS_PROFILE"
          ? { ...entry, value: "bedrock-dev" }
          : entry.name === "AWS_REGION"
            ? { ...entry, value: "us-west-2" }
            : entry,
      ),
      { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
    ]);
    expect(saved.map(({ name, value }) => [name, value])).toEqual([
      ["CLAUDE_CODE_USE_BEDROCK", "1"],
      ["AWS_PROFILE", "bedrock-dev"],
      ["AWS_REGION", "us-west-2"],
      ["ANTHROPIC_API_KEY", ""],
    ]);
  });

  it("is offered unless a policy pins the environment or one of its variables", () => {
    expect(bedrockPresetAllowed(undefined)).toBe(true);
    expect(bedrockPresetAllowed(locks(["CLAUDE_CONFIG_DIR"]))).toBe(true);
    expect(bedrockPresetAllowed(locks(["AWS_REGION"]))).toBe(false);
    expect(bedrockPresetAllowed(locks([], true))).toBe(false);
  });
});
