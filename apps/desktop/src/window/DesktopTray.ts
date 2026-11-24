import type { DesktopTraySettings, DesktopTraySettingsUpdate } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { Message, sessionBus } from "dbus-next";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { m } from "../i18n/messages.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import {
  LAUNCH_HIDDEN_ARGUMENT,
  renderAutostartDesktopEntry,
  shouldStartHidden,
  trayServerStatus,
  type TrayServerStatus,
} from "./DesktopTrayPolicy.ts";

export class DesktopTrayLoginItemError extends Schema.TaggedError<DesktopTrayLoginItemError>()(
  "DesktopTrayLoginItemError",
  {
    enabled: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.enabled
      ? "Could not add T3 Code to the apps that open at login."
      : "Could not remove T3 Code from the apps that open at login.";
  }
}

export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    /** Creates the tray when close-to-tray is on; true when this login launch stays in the tray. */
    readonly start: Effect.Effect<boolean, never, Scope.Scope>;
    readonly settings: Effect.Effect<DesktopTraySettings>;
    readonly update: (
      update: DesktopTraySettingsUpdate,
    ) => Effect.Effect<
      DesktopTraySettings,
      DesktopAppSettings.DesktopSettingsWriteError | DesktopTrayLoginItemError
    >;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

const { logInfo: logTrayInfo, logWarning: logTrayWarning } = makeComponentLogger("desktop-tray");

const STATUS_REFRESH_INTERVAL = Duration.seconds(2);

const STATUS_LABELS: Record<TrayServerStatus, string> = {
  running: msg("Server: running"),
  starting: msg("Server: starting"),
  failing: msg("Server: failing to start"),
  stopped: msg("Server: stopped"),
  stopping: msg("Server: stopping"),
  external: msg("Server: managed outside this app"),
};

// Electron's Linux tray is a StatusNotifierItem; without a watcher (stock GNOME) nothing is shown.
const hasStatusNotifierHost = Effect.tryPromise({
  try: async (signal) => {
    const bus = sessionBus();
    bus.on("error", () => undefined);
    signal.addEventListener("abort", () => bus.disconnect());
    try {
      const reply = await bus.call(
        new Message({
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "NameHasOwner",
          signature: "s",
          body: ["org.kde.StatusNotifierWatcher"],
        }),
      );
      return reply?.body[0] === true;
    } finally {
      bus.disconnect();
    }
  },
  catch: (cause) => cause,
}).pipe(
  Effect.timeout("2 seconds"),
  Effect.orElseSucceed(() => false),
);

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const desktopState = yield* DesktopState.DesktopState;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
  const electronApp = yield* ElectronApp.ElectronApp;
  const fileSystem = yield* FileSystem.FileSystem;

  // Unpackaged builds would register the bare Electron binary.
  const launchAtLoginSupported =
    environment.isPackaged &&
    (environment.platform === "win32" ||
      environment.platform === "darwin" ||
      environment.platform === "linux");
  let available = false;
  let tray: Electron.Tray | undefined;
  let menuKey = "";

  const openWindow = () => {
    Effect.runFork(desktopWindow.activate.pipe(Effect.ignoreCause));
  };
  // The same quit as the app menu's, so before-quit runs the full shutdown.
  const quitApp = () => {
    Effect.runFork(electronApp.quit);
  };

  const readStatus = Effect.gen(function* () {
    const settings = yield* appSettings.get;
    const primary = yield* backendPool.primary;
    return trayServerStatus({
      localEnvironmentEnabled: settings.localEnvironmentEnabled,
      quitting: yield* Ref.get(desktopState.quitting),
      startup: yield* SubscriptionRef.get(desktopState.primaryBackendStartup),
      snapshot: yield* primary.snapshot,
    });
  });

  const refreshMenu = Effect.gen(function* () {
    const current = tray;
    if (current === undefined || current.isDestroyed()) return;
    const labels = [
      m(msg("Open T3 Code")),
      m(STATUS_LABELS[yield* readStatus]),
      m(msg("Quit T3 Code")),
    ] as const;
    const key = labels.join("\n");
    if (key === menuKey) return;
    menuKey = key;
    current.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: labels[0], click: openWindow },
        { label: labels[1], enabled: false },
        { type: "separator" },
        { label: labels[2], click: quitApp },
      ]),
    );
  });

  const trayIcon = Effect.gen(function* () {
    const iconPaths = yield* assets.iconPaths;
    const iconPath =
      environment.platform === "win32"
        ? Option.orElse(iconPaths.ico, () => iconPaths.png)
        : iconPaths.png;
    if (Option.isNone(iconPath)) return Option.none<Electron.NativeImage>();
    const image = Electron.nativeImage.createFromPath(iconPath.value);
    if (image.isEmpty()) return Option.none<Electron.NativeImage>();
    if (environment.platform === "win32") return Option.some(image);
    // shortcut: macOS gets the resized app icon, not a monochrome template image; ship a
    // `*Template.png` asset when the menu bar icon should follow light and dark menu bars.
    const size = environment.platform === "darwin" ? 18 : 32;
    return Option.some(image.resize({ width: size, height: size }));
  });

  const destroyTray = () => {
    if (tray !== undefined && !tray.isDestroyed()) tray.destroy();
    tray = undefined;
    menuKey = "";
  };

  const createTray = Effect.gen(function* () {
    if (tray !== undefined && !tray.isDestroyed()) return true;
    const icon = yield* trayIcon;
    if (Option.isNone(icon)) {
      yield* logTrayWarning("no tray icon found; closing the window will quit");
      return false;
    }
    const created = yield* Effect.try({
      try: () => new Electron.Tray(icon.value),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((value) => Option.some(value)),
      Effect.catch((cause) =>
        logTrayWarning("could not create the tray; closing the window will quit", {
          cause: String(cause),
        }).pipe(Effect.as(Option.none<Electron.Tray>())),
      ),
    );
    if (Option.isNone(created)) return false;
    created.value.setToolTip(environment.displayName);
    // macOS opens the context menu on click, as menu bar items do.
    if (environment.platform !== "darwin") created.value.on("click", openWindow);
    tray = created.value;
    yield* refreshMenu;
    return true;
  });

  const syncTray = Effect.fn("desktop.tray.sync")(function* (closeToTray: boolean) {
    const active = closeToTray && available && (yield* createTray);
    if (!active) destroyTray();
    yield* Ref.set(desktopState.trayActive, active);
    return active;
  });

  const showStillRunningHint = () => {
    const title = m(msg("T3 Code is still running"));
    const content = m(
      msg("Agents keep working in the background. Open or quit T3 Code from its tray icon."),
    );
    if (environment.platform === "win32") {
      tray?.displayBalloon({ title, content, iconType: "info" });
      return;
    }
    if (!Electron.Notification.isSupported()) return;
    const notification = new Electron.Notification({ title, body: content });
    notification.show();
  };

  const onAllWindowsClosed = Effect.gen(function* () {
    if (yield* Ref.get(desktopState.quitting)) return;
    if (!(yield* Ref.get(desktopState.trayActive))) return;
    yield* Ref.set(desktopState.mainHiddenInTray, true);
    // macOS apps routinely keep running without windows, so no hint there.
    if (environment.platform === "darwin" || (yield* appSettings.get).trayHintShown) return;
    showStillRunningHint();
    yield* appSettings.setTraySettings({ trayHintShown: true }).pipe(Effect.ignore);
  }).pipe(Effect.withSpan("desktop.tray.allWindowsClosed"));

  const launchedAtLogin = Effect.gen(function* () {
    if (environment.platform !== "darwin") {
      return (yield* HostProcess.Arguments).includes(LAUNCH_HIDDEN_ARGUMENT);
    }
    const loginItem = Electron.app.getLoginItemSettings();
    // Deprecated in Electron's macOS types; macOS 13+ no longer reports them, so the window shows.
    return (
      Reflect.get(loginItem, "wasOpenedAtLogin") === true ||
      Reflect.get(loginItem, "wasOpenedAsHidden") === true
    );
  });

  const writeLinuxAutostart = Effect.fn("desktop.tray.writeLinuxAutostart")(function* (
    enabled: boolean,
  ) {
    const env = yield* HostProcess.Environment;
    const configHome =
      env.XDG_CONFIG_HOME?.trim() ||
      environment.path.join(yield* HostProcess.HomeDirectory, ".config");
    const directory = environment.path.join(configHome, "autostart");
    const entryPath = environment.path.join(directory, environment.linuxDesktopEntryName);
    // A mounted AppImage's execPath is transient; launch the AppImage itself, as the URL handler does.
    const launcher = Option.orElse(environment.desktopLauncherPath, () => environment.appImagePath);
    const execTarget = Option.isSome(launcher) ? launcher.value : yield* HostProcess.ExecutablePath;
    const entry = renderAutostartDesktopEntry({ displayName: environment.displayName, execTarget });
    const write = enabled
      ? fileSystem
          .makeDirectory(directory, { recursive: true })
          .pipe(Effect.andThen(fileSystem.writeFileString(entryPath, entry)))
      : fileSystem.remove(entryPath, { force: true });
    yield* write.pipe(Effect.mapError((cause) => new DesktopTrayLoginItemError({ enabled, cause })));
  });

  const applyLaunchAtLogin = Effect.fn("desktop.tray.applyLaunchAtLogin")(function* (
    enabled: boolean,
  ) {
    if (environment.platform === "linux") return yield* writeLinuxAutostart(enabled);
    // Not a literal: `openAsHidden` is deprecated in Electron's types. Windows removes an entry
    // only when the args match the ones it was added with.
    const loginItem = { openAtLogin: enabled, openAsHidden: true, args: [LAUNCH_HIDDEN_ARGUMENT] };
    yield* Effect.try({
      try: () => Electron.app.setLoginItemSettings(loginItem),
      catch: (cause) => new DesktopTrayLoginItemError({ enabled, cause }),
    });
  });

  const settings = Effect.gen(function* () {
    const current = yield* appSettings.get;
    return {
      closeToTray: current.closeToTray,
      launchAtLogin: current.launchAtLogin,
      trayAvailable: available,
      launchAtLoginSupported,
    };
  });

  return DesktopTray.of({
    start: Effect.gen(function* () {
      available =
        environment.platform === "linux"
          ? yield* hasStatusNotifierHost
          : environment.platform === "win32" || environment.platform === "darwin";
      yield* electronApp.on("window-all-closed", () => {
        Effect.runFork(onAllWindowsClosed);
      });
      yield* Effect.addFinalizer(() => Effect.sync(destroyTray));
      const current = yield* appSettings.get;
      const active = yield* syncTray(current.closeToTray);
      // The backend reports readiness changes without an event, so the status label polls.
      const refreshLoop = refreshMenu.pipe(Effect.andThen(Effect.sleep(STATUS_REFRESH_INTERVAL)));
      yield* Effect.forkScoped(Effect.forever(refreshLoop));
      const hidden = shouldStartHidden({
        launchedAtLogin: current.launchAtLogin && (yield* launchedAtLogin),
        trayActive: active,
      });
      if (hidden) yield* Ref.set(desktopState.mainHiddenInTray, true);
      yield* logTrayInfo("tray configured", { available, active, hidden });
      return hidden;
    }).pipe(Effect.withSpan("desktop.tray.start")),
    settings,
    update: Effect.fn("desktop.tray.update")(function* (change) {
      const previous = yield* appSettings.get;
      const launchAtLogin = launchAtLoginSupported ? change.launchAtLogin : undefined;
      if (launchAtLogin !== undefined && launchAtLogin !== previous.launchAtLogin) {
        yield* applyLaunchAtLogin(launchAtLogin);
      }
      const { settings: next } = yield* appSettings.setTraySettings({
        ...(change.closeToTray === undefined ? {} : { closeToTray: change.closeToTray }),
        ...(launchAtLogin === undefined ? {} : { launchAtLogin }),
      });
      yield* syncTray(next.closeToTray);
      return yield* settings;
    }),
  });
});

export const layer = Layer.effect(DesktopTray, make);
