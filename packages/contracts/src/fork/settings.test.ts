import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { ServerSettings, ServerSettingsPatch } from "../settings.ts";

const decodeServerSettings = Schema.decodeSync(ServerSettings);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeSync(ServerSettingsPatch);
const decodeUpstreamSettings = Schema.decodeSync(ServerSettings.mapFields(Struct.omit(["cmdeck"])));

describe("cmdeck settings key", () => {
  it("decodes settings without a cmdeck key to the fork defaults", () => {
    const defaults = {
      memoryEnabled: false,
      decisionModel: null,
      routingTierModels: {},
      usageAlertPercents: [80],
      approvalPolicy: {
        denyCommands: [],
        denyTools: [],
        protectedPaths: [],
        denyWritesOutsideWorkspace: false,
      },
    };
    expect(decodeServerSettings({}).cmdeck).toEqual(defaults);
    expect(decodeServerSettings({ cmdeck: {} }).cmdeck).toEqual(defaults);
    expect(decodeServerSettingsPatch({ cmdeck: {} })).toEqual({ cmdeck: {} });
    expect(decodeServerSettings({ cmdeck: { memoryEnabled: true } }).cmdeck.memoryEnabled).toBe(
      true,
    );
  });

  it("keeps usage alert thresholds whole percentages from 1 to 100", () => {
    expect(
      decodeServerSettings({ cmdeck: { usageAlertPercents: [] } }).cmdeck.usageAlertPercents,
    ).toEqual([]);
    expect(decodeServerSettingsPatch({ cmdeck: { usageAlertPercents: [50, 100] } })).toEqual({
      cmdeck: { usageAlertPercents: [50, 100] },
    });
    for (const invalid of [0, 101, 79.5]) {
      expect(() =>
        decodeServerSettingsPatch({ cmdeck: { usageAlertPercents: [invalid] } }),
      ).toThrow();
    }
  });

  it("leaves CMDeck settings decodable by a client built from upstream's schema", () => {
    const stored = encodeServerSettings(decodeServerSettings({}));
    expect(stored).toHaveProperty("cmdeck");
    expect(decodeUpstreamSettings(stored)).not.toHaveProperty("cmdeck");
  });
});
