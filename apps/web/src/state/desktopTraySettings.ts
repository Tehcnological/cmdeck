import type { DesktopBridge, DesktopTraySettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { msg } from "gt-react";

import { m } from "../i18n/messages";

type DesktopTrayBridge = Required<Pick<DesktopBridge, "getTraySettings" | "setTraySettings">>;

class DesktopTraySettingsUnavailableError extends Schema.TaggedError<DesktopTraySettingsUnavailableError>()(
  "DesktopTraySettingsUnavailableError",
  {},
) {
  override get message(): string {
    return m(msg("Tray settings are unavailable."));
  }
}

class DesktopTraySettingsLoadError extends Schema.TaggedError<DesktopTraySettingsLoadError>()(
  "DesktopTraySettingsLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return m(msg("Failed to load tray settings."));
  }
}

/** Absent outside the desktop app and in desktop builds without a tray. */
export function getDesktopTrayBridge(): DesktopTrayBridge | undefined {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const getTraySettings = bridge?.getTraySettings;
  const setTraySettings = bridge?.setTraySettings;
  return getTraySettings && setTraySettings ? { getTraySettings, setTraySettings } : undefined;
}

const loadDesktopTraySettings = Effect.fn("loadDesktopTraySettings")(function* () {
  const bridge = getDesktopTrayBridge();
  if (!bridge) {
    return yield* new DesktopTraySettingsUnavailableError();
  }
  return yield* Effect.tryPromise({
    try: (): Promise<DesktopTraySettings> => bridge.getTraySettings(),
    catch: (cause) => new DesktopTraySettingsLoadError({ cause }),
  });
});

export const desktopTraySettingsAtom = Atom.make(loadDesktopTraySettings()).pipe(
  Atom.keepAlive,
  Atom.withLabel("desktop:tray-settings:load"),
);

export function refreshDesktopTraySettings(): void {
  appAtomRegistry.refresh(desktopTraySettingsAtom);
}
