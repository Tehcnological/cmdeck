import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { DesktopUninstallPlan } from "@t3tools/contracts";
import { msg, T, useGT } from "gt-react";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { m } from "../../i18n/messages";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const CONFIRMATION_PHRASE = "UNINSTALL";

const errorToast = (title: string, error: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description:
        error instanceof Error
          ? (thrownErrorMessage(error, m) ?? error.message)
          : m(msg("Something went wrong.")),
    }),
  );

export function UninstallSettingsSection() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.uninstall;
  const gt = useGT();
  const setting = useSearchableSetting();
  const [open, setOpen] = useState(false);
  const [removeData, setRemoveData] = useState(false);
  const [plan, setPlan] = useState<DesktopUninstallPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);

  if (!bridge) return null;

  const loadPlan = (nextRemoveData: boolean) => {
    setPlan(null);
    void bridge
      .getPlan({ removeData: nextRemoveData })
      .then(setPlan)
      .catch((error: unknown) => {
        setOpen(false);
        errorToast(m(msg("Could not prepare the uninstall")), error);
      });
  };

  const openDialog = () => {
    setOpen(true);
    setRemoveData(false);
    setConfirmation("");
    loadPlan(false);
  };

  const confirm = () => {
    setRunning(true);
    void bridge.run({ removeData }).catch((error: unknown) => {
      setRunning(false);
      errorToast(m(msg("Could not uninstall CMDeck")), error);
    });
  };

  const describe = (action: DesktopUninstallPlan["actions"][number]) => {
    switch (action.kind) {
      case "stop-service":
        return gt("Background service: {path}", { path: action.target });
      case "remove-launcher":
        return gt("Command: {path}", { path: action.target });
      case "remove-path-entry":
        return gt("PATH entry: {path}", { path: action.target });
      case "run-app-uninstaller":
        return gt("Desktop app, through its uninstaller: {path}", { path: action.target });
      case "remove-app":
        return gt("Desktop app: {path}", { path: action.target });
      case "remove-app-manually":
        return gt("Desktop app: delete the AppImage or remove the cmdeck package yourself");
      case "remove-data":
        return action.target;
    }
  };

  const canConfirm =
    plan !== null &&
    plan.supported &&
    !running &&
    (!removeData || confirmation.trim() === CONFIRMATION_PHRASE);

  return (
    <>
      <SettingsSection id="uninstall" title={gt("Uninstall")}>
        <SettingsRow
          {...setting("uninstall-app")}
          description={gt(
            "Remove CMDeck from this computer. You choose whether your threads and settings go too.",
          )}
          control={
            <Button size="sm" variant="destructive-outline" onClick={openDialog}>
              <Trash2Icon />
              <T>Uninstall…</T>
            </Button>
          }
        />
      </SettingsSection>

      <AlertDialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Uninstall CMDeck?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>
                CMDeck quits and then removes itself. The official T3 Code, your projects and your
                providers' own settings are never touched.
              </T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 px-6 text-sm">
            <label className="flex cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed">
              <Checkbox
                checked={removeData}
                disabled={running}
                onCheckedChange={(checked) => {
                  setRemoveData(checked);
                  setConfirmation("");
                  loadPlan(checked);
                }}
              />
              <T>Also remove all CMDeck data (threads, settings, sign-ins)</T>
            </label>
            {plan === null ? (
              <p className="text-muted-foreground text-xs">
                <T>Checking what is installed…</T>
              </p>
            ) : !plan.supported ? (
              <p className="text-muted-foreground text-xs">
                <T>Development builds cannot uninstall themselves.</T>
              </p>
            ) : (
              <>
                <p className="font-medium text-xs">
                  <T>This removes:</T>
                </p>
                <ul className="max-h-44 overflow-y-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-2xs leading-relaxed">
                  {plan.actions.length === 0 ? <li>{gt("Nothing")}</li> : null}
                  {plan.actions.map((action) => (
                    <li key={`${action.kind}:${action.target}`} className="break-all">
                      {describe(action)}
                    </li>
                  ))}
                </ul>
                {plan.refusals.length > 0 ? (
                  <>
                    <p className="font-medium text-xs">
                      <T>Kept, because it might not be CMDeck's:</T>
                    </p>
                    <ul className="rounded-lg border p-2.5 font-mono text-2xs leading-relaxed">
                      {plan.refusals.map((refusal) => (
                        <li key={refusal} className="break-all">
                          {refusal}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
            {removeData ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="uninstall-confirmation" className="font-medium text-xs">
                  {gt("Type {phrase} to delete your data for good:", {
                    phrase: CONFIRMATION_PHRASE,
                  })}
                </label>
                <Input
                  id="uninstall-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={CONFIRMATION_PHRASE}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={running}
                />
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={running} />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button variant="destructive" disabled={!canConfirm} onClick={confirm}>
              {removeData ? <T>Remove app and all data</T> : <T>Remove app only</T>}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
