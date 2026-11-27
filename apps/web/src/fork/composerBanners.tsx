import { useGT } from "gt-react";
import { ServerIcon } from "lucide-react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import type { DraftSessionState } from "../composerDraftStore";
import { useConnectedEnvironmentIds, useEnvironmentIdentities } from "../state/environments";
import {
  defaultEnvironmentIsUnavailable,
  useDefaultThreadEnvironmentId,
} from "./defaultThreadEnvironment";

const NO_ITEMS: ReadonlyArray<ComposerBannerStackItem> = [];

/** Fork notices in the composer's banner stack. `draftThread` is null once the thread is sent. */
export function useForkComposerBannerItems(input: {
  readonly draftThread: DraftSessionState | null;
}): ReadonlyArray<ComposerBannerStackItem> {
  const gt = useGT();
  const [preferredEnvironmentId] = useDefaultThreadEnvironmentId();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const identities = useEnvironmentIdentities();
  const { draftThread } = input;
  if (
    draftThread === null ||
    draftThread.promotedTo != null ||
    !defaultEnvironmentIsUnavailable(draftThread, {
      preferredEnvironmentId,
      connectedEnvironmentIds,
    })
  ) {
    return NO_ITEMS;
  }
  const labelOf = (environmentId: string | null) =>
    identities.find((identity) => identity.environmentId === environmentId)?.label ?? null;
  const preferredLabel = labelOf(preferredEnvironmentId);
  const currentLabel = labelOf(draftThread.environmentId) ?? draftThread.environmentId;
  return [
    {
      id: "fork:default-environment",
      variant: "info",
      group: "environment",
      icon: <ServerIcon />,
      title:
        preferredLabel === null
          ? gt("Your default environment is not connected")
          : gt("{environment} is not connected", { environment: preferredLabel }),
      description: gt("This thread starts on {environment}.", { environment: currentLabel }),
    },
  ];
}
