import type { PrimaryBackendStartup } from "../app/DesktopState.ts";
import { escapeDesktopEntryExecArgument } from "../app/DesktopLinuxUrlHandler.ts";
import type { DesktopBackendSnapshot } from "../backend/DesktopBackendManager.ts";

/** Passed by the login item on Windows and Linux; macOS reports a login launch itself. */
export const LAUNCH_HIDDEN_ARGUMENT = "--launch-hidden";

export type TrayServerStatus =
  | "running"
  | "starting"
  | "failing"
  | "stopped"
  | "stopping"
  | "external";

export function trayServerStatus(input: {
  readonly localEnvironmentEnabled: boolean;
  readonly quitting: boolean;
  readonly startup: PrimaryBackendStartup;
  readonly snapshot: Pick<DesktopBackendSnapshot, "ready" | "desiredRunning">;
}): TrayServerStatus {
  // Without a local environment this app runs no server; a background service or remote one does.
  if (!input.localEnvironmentEnabled) return "external";
  if (input.quitting) return "stopping";
  if (input.snapshot.ready) return "running";
  if (input.startup._tag === "Failing") return "failing";
  return input.snapshot.desiredRunning ? "starting" : "stopped";
}

/** A login launch starts in the tray only when the tray can bring the window back. */
export function shouldStartHidden(input: {
  readonly launchedAtLogin: boolean;
  readonly trayActive: boolean;
}): boolean {
  return input.launchedAtLogin && input.trayActive;
}

export function renderAutostartDesktopEntry(input: {
  readonly displayName: string;
  readonly execTarget: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${input.displayName.replace(/[\r\n]/gu, " ")}`,
    `Exec=${escapeDesktopEntryExecArgument(input.execTarget)} ${LAUNCH_HIDDEN_ARGUMENT}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}
