import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { ClientServerSettingsPatch, ServerSettings, ServerSettingsPatch } from "../settings.ts";

const decodeServerSettings = Schema.decodeSync(ServerSettings);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeSync(ServerSettingsPatch);
const decodeClientPatch = Schema.decodeUnknownSync(ClientServerSettingsPatch);
const decodeUnknownSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeUpstreamSettings = Schema.decodeSync(ServerSettings.mapFields(Struct.omit(["cmdeck"])));

describe("cmdeck settings key", () => {
  it("decodes settings without a cmdeck key to the fork defaults", () => {
    const defaults = {
      memoryEnabled: false,
      decisionModel: null,
      routingTierModels: {},
      memoryEmbedder: null,
      usageAlertPercents: [80],
      approvalPolicy: {
        denyCommands: [],
        denyTools: [],
        protectedPaths: [],
        denyWritesOutsideWorkspace: false,
      },
      agentDiscipline: {
        enabled: true,
        subagentCap: 2,
        reviewRoundCap: 2,
        checkpointMinutes: 20,
        stallLimit: 3,
      },
      heartbeat: { enabled: false, environments: false, sessionStallMinutes: 15, probes: [] },
    };
    expect(decodeServerSettings({}).cmdeck).toEqual(defaults);
    expect(decodeServerSettings({ cmdeck: {} }).cmdeck).toEqual(defaults);
    expect(decodeServerSettingsPatch({ cmdeck: {} })).toEqual({ cmdeck: {} });
    expect(decodeServerSettings({ cmdeck: { memoryEnabled: true } }).cmdeck.memoryEnabled).toBe(
      true,
    );
    // A partial agent discipline block keeps the other defaults.
    expect(
      decodeServerSettings({ cmdeck: { agentDiscipline: { subagentCap: 4 } } }).cmdeck
        .agentDiscipline,
    ).toEqual({ ...defaults.agentDiscipline, subagentCap: 4 });
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

describe("container recipe", () => {
  // The recipe decides what a sandboxed agent can reach; only the sandbox service, which
  // validates and audits, may change it. A client's settings patch must not carry it.
  it("is not part of any settings patch", () => {
    const patch = { cmdeck: { sandbox: { image: "acme/agent:1", network: "host" } } };
    expect(decodeClientPatch(patch)).toEqual({ cmdeck: {} });
    expect(decodeUnknownSettings(patch).cmdeck).not.toHaveProperty("sandbox");
  });
});
