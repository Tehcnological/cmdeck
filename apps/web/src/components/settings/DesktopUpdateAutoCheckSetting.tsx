import { useGT } from "gt-react";
import { useEffect, useState } from "react";

import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function DesktopUpdateAutoCheckSetting({ disabled }: { readonly disabled: boolean }) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const bridge = window.desktopBridge;
  const [enabled, setEnabled] = useState<boolean | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the saved value from the desktop process once.
  useEffect(() => {
    let active = true;
    void bridge?.getUpdateAutoCheck().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  if (!bridge) return null;

  const change = (next: boolean) => {
    setEnabled(next);
    bridge.setUpdateAutoCheck(next).then(setEnabled, () => {
      setEnabled(!next);
      toastManager.add({ type: "error", title: gt("Couldn't change this setting.") });
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("update-auto-check")}
      description={gt(
        "Look for a new CMDeck release shortly after launch and every 4 hours. Check for updates still works when this is off.",
      )}
      control={
        <Switch
          checked={enabled ?? true}
          disabled={disabled || enabled === null}
          onCheckedChange={(checked) => change(Boolean(checked))}
          aria-label={gt("Check for updates automatically")}
        />
      }
    />
  );
}
