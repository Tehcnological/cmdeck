import { ProviderDriverKind } from "@t3tools/contracts";

export interface PiFlavor {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly binaryName: string;
  readonly npmPackageName: string;
  readonly miseTool?: string;
  readonly probeDirName: string;
  readonly defaultAgentDirSegments: readonly [string, ...string[]];
}

export const PI_FLAVOR: PiFlavor = {
  driverKind: ProviderDriverKind.make("pi"),
  displayName: "Pi",
  binaryName: "pi",
  npmPackageName: "@earendil-works/pi-coding-agent",
  miseTool: "pi",
  probeDirName: "pi-status-probe",
  defaultAgentDirSegments: [".pi", "agent"],
};
