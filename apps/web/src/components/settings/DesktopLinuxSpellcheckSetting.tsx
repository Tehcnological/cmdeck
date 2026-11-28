import { useGT } from "gt-react";
import { useEffect, useState } from "react";

import { isLinuxPlatform } from "~/lib/utils";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

/** Windows and macOS spellcheck with the OS and download nothing, so only Linux gets a switch. */
export function DesktopLinuxSpellcheckSetting() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const bridge = isLinuxPlatform(navigator.platform) ? window.desktopBridge : undefined;
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the saved value from the desktop process once.
  useEffect(() => {
    let active = true;
    void bridge?.getLinuxSpellcheck().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  if (!bridge) return null;

  const change = (next: boolean) => {
    setEnabled(next);
    bridge.setLinuxSpellcheck(next).then(setEnabled, () => {
      setEnabled(!next);
      toastManager.add({ type: "error", title: gt("Couldn't change this setting.") });
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("linux-spellcheck")}
      description={gt(
        "Underline misspelled words and suggest fixes. Turning this on downloads spelling dictionaries from Google.",
      )}
      control={
        <Switch
          checked={enabled ?? false}
          disabled={enabled === null}
          onCheckedChange={(checked) => change(Boolean(checked))}
          aria-label={gt("Spellcheck")}
        />
      }
    />
  );
}
