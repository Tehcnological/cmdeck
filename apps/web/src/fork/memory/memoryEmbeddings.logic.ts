import type { InferenceServerSnapshot, MemoryEmbedderSetting } from "@t3tools/contracts";
import {
  isPrivateNetworkHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@t3tools/shared/hostClassification";

export const KEYWORDS_ONLY = "keywords";

export interface EmbedderOption {
  readonly value: string;
  readonly setting: MemoryEmbedderSetting;
  readonly serverName: string;
}

export const embedderValue = (setting: MemoryEmbedderSetting | null): string =>
  setting === null ? KEYWORDS_ONLY : JSON.stringify([setting.serverId, setting.model]);

// Mirrors the server's rule; the server refuses any other address whatever the client sends.
const isLocalAddress = (baseUrl: string): boolean => {
  try {
    const host = new URL(baseUrl).hostname;
    return isPrivateNetworkHost(host) || isSharedAddressSpaceHost(host) || isTailnetHost(host);
  } catch {
    return false;
  }
};

/**
 * Every model of each enabled server on this machine, the local network or the tailnet. The chosen
 * embedder stays listed after its server drops it, so the picker still shows what is set.
 */
export const embedderOptions = (
  snapshots: ReadonlyArray<InferenceServerSnapshot>,
  current: MemoryEmbedderSetting | null,
): ReadonlyArray<EmbedderOption> => {
  const options = snapshots
    .filter((server) => server.enabled && isLocalAddress(server.baseUrl))
    .flatMap((server) =>
      server.models.map((model) => {
        const setting = { serverId: server.id, model: model.id };
        return { value: embedderValue(setting), setting, serverName: server.displayName };
      }),
    );
  if (current === null || options.some((option) => option.value === embedderValue(current))) {
    return options;
  }
  return [
    { value: embedderValue(current), setting: current, serverName: current.serverId },
    ...options,
  ];
};

/** The setting a picked value stands for; null keeps search on keywords. */
export const settingForValue = (
  options: ReadonlyArray<EmbedderOption>,
  value: string,
): MemoryEmbedderSetting | null =>
  options.find((option) => option.value === value)?.setting ?? null;
