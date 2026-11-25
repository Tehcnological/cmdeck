import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { DesktopTraySettingsUpdate } from "@t3tools/contracts";
import { msg, useGT } from "gt-react";
import { useState } from "react";

import { m } from "~/i18n/messages";
import {
  desktopTraySettingsAtom,
  getDesktopTrayBridge,
  refreshDesktopTraySettings,
} from "~/state/desktopTraySettings";
import { useEnvironmentQuery } from "~/state/query";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/** Close to tray and launch at login; renders nothing outside the desktop app. */
export function DesktopTraySettings() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const bridge = getDesktopTrayBridge();
  const query = useEnvironmentQuery(bridge ? desktopTraySettingsAtom : null);
  const [pending, setPending] = useState(false);
  const state = query.data;
  if (!bridge || !state) return null;

  const apply = (update: DesktopTraySettingsUpdate) => {
    if (pending) return;
    setPending(true);
    void bridge
      .setTraySettings(update)
      .then(refreshDesktopTraySettings)
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not change this setting")),
            description:
              error instanceof Error
                ? (thrownErrorMessage(error, m) ?? error.message)
                : m(msg("Something went wrong.")),
          }),
        );
      })
      .finally(() => setPending(false));
  };

  return (
    <>
      <SettingsRow
        {...setting("close-to-tray")}
        description={
          state.trayAvailable
            ? gt(
                "Closing the window keeps CMDeck, its server, and running agents going in the tray.",
              )
            : gt("This desktop has no system tray, so closing the window quits CMDeck.")
        }
        control={
          <Switch
            checked={state.trayAvailable && state.closeToTray}
            disabled={pending || !state.trayAvailable}
            onCheckedChange={(checked) => apply({ closeToTray: Boolean(checked) })}
            aria-label={gt("Close to tray")}
          />
        }
      />
      {state.launchAtLoginSupported ? (
        <SettingsRow
          {...setting("launch-at-login")}
          description={gt(
            "Start CMDeck when you log in. With close to tray on, it starts in the tray without opening a window.",
          )}
          control={
            <Switch
              checked={state.launchAtLogin}
              disabled={pending}
              onCheckedChange={(checked) => apply({ launchAtLogin: Boolean(checked) })}
              aria-label={gt("Launch at login")}
            />
          }
        />
      ) : null}
    </>
  );
}
