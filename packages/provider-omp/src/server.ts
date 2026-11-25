import { ProviderDriverKind } from "@t3tools/contracts";
import { createPiDriver, type PiDriverEnv, type PiFlavor } from "@t3tools/provider-pi/server";
import * as Schema from "effect/Schema";

import { OmpSettings } from "./settings.ts";

const OMP_FLAVOR: PiFlavor = {
  driverKind: ProviderDriverKind.make("omp"),
  displayName: "OMP",
  binaryName: "omp",
  npmPackageName: "@oh-my-pi/pi-coding-agent",
  probeDirName: "omp-status-probe",
  defaultAgentDirSegments: [".omp", "agent"],
};

const DEFAULT_OMP_SETTINGS = Schema.decodeSync(OmpSettings)({});

export type OmpDriverEnv = PiDriverEnv;

export const OmpDriver = createPiDriver({
  flavor: OMP_FLAVOR,
  configSchema: OmpSettings,
  defaultConfig: () => DEFAULT_OMP_SETTINGS,
});
