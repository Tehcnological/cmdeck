import type { ServerConfig } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerConfigAtom } from "../state/server";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** Fork-only: the server reports data-folder problems (a database from a newer T3 Code, a runtime
 * CMDeck did not install). The description is server-authored English; it stays up until
 * dismissed, once per page load. */
export function startForkSharedDataToasts(): () => void {
  const shown = new Set<string>();
  const show = (config: ServerConfig | null) => {
    for (const issue of config?.issues ?? []) {
      if (issue.kind !== "fork.shared-data" || shown.has(issue.message)) continue;
      shown.add(issue.message);
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: m(msg("Check this data folder")),
          description: issue.message,
          timeout: 0,
        }),
      );
    }
  };
  return appAtomRegistry.subscribe(primaryServerConfigAtom, show, { immediate: true });
}
