import type { ServerConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { m } from "../i18n/messages";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerConfigAtom } from "../state/server";
import { stackedThreadToast, toastManager } from "./ui/toast";

const DISMISSED_KEY = "cmdeck:import-from-t3:dismissed";

const dismissed = () => {
  try {
    return getLocalStorageItem(DISMISSED_KEY, Schema.Boolean) === true;
  } catch {
    // Storage that cannot be read could not keep a dismissal, so never ask.
    return true;
  }
};

/** Fork-only: offers once to import the official T3 Code's data, until dismissed. The server only
 * reports the offer while this build's database has no threads; the import itself is a CLI command
 * because it replaces the database the running server holds open. */
export function startForkImportOfferToast(): () => void {
  let shown = false;
  const show = (config: ServerConfig | null) => {
    if (shown) return;
    const offer = config?.issues.find((issue) => issue.kind === "fork.import-available");
    if (offer?.kind !== "fork.import-available" || dismissed()) return;
    shown = true;
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: m(msg("Import your T3 Code threads and settings?")),
        description: `${offer.message}\n\n${offer.command}`,
        timeout: 0,
        actionProps: {
          children: m(msg("Copy dry-run command")),
          onClick: () => void navigator.clipboard?.writeText(`${offer.command} --dry-run`),
        },
        actionVariant: "outline",
        data: {
          hideCopyButton: true,
          onClose: () => {
            try {
              setLocalStorageItem(DISMISSED_KEY, true, Schema.Boolean);
            } catch {}
          },
        },
      }),
    );
  };
  return appAtomRegistry.subscribe(primaryServerConfigAtom, show, { immediate: true });
}
