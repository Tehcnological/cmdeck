import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { vi } from "vite-plus/test";

interface FakeMenuItem {
  readonly label?: string;
  readonly enabled?: boolean;
  readonly type?: string;
  readonly click?: () => void;
}

interface FakeImage {
  readonly isEmpty: () => boolean;
  readonly resize: () => FakeImage;
}

const electron = vi.hoisted(() => {
  const state = { failTrayCreation: false, loginItems: [] as unknown[] };
  class FakeTray {
    menu: ReadonlyArray<FakeMenuItem> = [];
    destroyed = false;
    readonly listeners = new Map<string, () => void>();
    constructor() {
      if (state.failTrayCreation) throw new Error("no StatusNotifier host");
      trays.push(this);
    }
    setToolTip() {}
    setContextMenu(menu: ReadonlyArray<FakeMenuItem>) {
      this.menu = menu;
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
    }
    displayBalloon() {}
    destroy() {
      this.destroyed = true;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  const trays: FakeTray[] = [];
  const image: FakeImage = { isEmpty: () => false, resize: () => image };
  return Object.assign(state, { FakeTray, image, trays });
});

vi.mock("electron", () => ({
  Tray: electron.FakeTray,
  Menu: { buildFromTemplate: (template: ReadonlyArray<FakeMenuItem>) => template },
  nativeImage: { createFromPath: () => electron.image },
  Notification: { isSupported: () => false },
  app: {
    getLoginItemSettings: () => ({}),
    setLoginItemSettings: (settings: unknown) => {
      electron.loginItems.push(settings);
    },
  },
}));

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import type * as DesktopBackendManager from "../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopTray from "./DesktopTray.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import { LAUNCH_HIDDEN_ARGUMENT } from "./DesktopTrayPolicy.ts";

function layerTray(
  input: {
    readonly settings?: DesktopAppSettings.DesktopSettings;
    readonly quit?: Effect.Effect<void>;
    readonly activate?: Effect.Effect<void>;
  } = {},
) {
  return DesktopTray.layer.pipe(
    Layer.provideMerge(DesktopAppSettings.layerTest(input.settings)),
    Layer.provideMerge(DesktopState.layer),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
          platform: "win32",
          isPackaged: true,
          displayName: "CMDeck",
        } as DesktopEnvironment.DesktopEnvironment["Service"]),
        Layer.mock(DesktopAssets.DesktopAssets, {
          iconPaths: Effect.succeed({
            ico: Option.some("C:\\CMDeck\\resources\\icon.ico"),
            icns: Option.none(),
            png: Option.none(),
          }),
        }),
        Layer.mock(DesktopWindow.DesktopWindow, { activate: input.activate ?? Effect.void }),
        Layer.mock(DesktopBackendPool.DesktopBackendPool, {
          primary: Effect.succeed({
            snapshot: Effect.succeed({ ready: true, desiredRunning: true }),
          } as unknown as DesktopBackendManager.DesktopBackendInstance),
        }),
        Layer.mock(ElectronApp.ElectronApp, {
          quit: input.quit ?? Effect.void,
          on: () => Effect.void,
        }),
        FileSystem.layerNoop({}),
      ),
    ),
  );
}

const resetElectron = Effect.sync(() => {
  electron.trays.length = 0;
  electron.loginItems.length = 0;
  electron.failTrayCreation = false;
});

describe("DesktopTray", () => {
  it.effect("keeps the app in a tray whose Quit runs the app's normal quit", () =>
    Effect.gen(function* () {
      yield* resetElectron;
      const quitRequested = yield* Deferred.make<void>();
      const activated = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.DesktopTray;
          const state = yield* DesktopState.DesktopState;
          assert.isFalse(yield* tray.start);
          assert.isTrue(yield* Ref.get(state.trayActive));

          const [created] = electron.trays;
          assert.deepEqual(
            created?.menu.map((item) => item.label ?? item.type),
            ["Open CMDeck", "Server: running", "separator", "Quit CMDeck"],
          );
          assert.isFalse(created?.menu[1]?.enabled);

          created?.listeners.get("click")?.();
          yield* Deferred.await(activated);
          created?.menu.find((item) => item.label === "Quit CMDeck")?.click?.();
          yield* Deferred.await(quitRequested);
        }),
      ).pipe(
        Effect.provide(
          layerTray({
            quit: Deferred.succeed(quitRequested, undefined).pipe(Effect.asVoid),
            activate: Deferred.succeed(activated, undefined).pipe(Effect.asVoid),
          }),
        ),
      );
      assert.isTrue(electron.trays[0]?.isDestroyed(), "the tray goes away with the app scope");
    }),
  );

  it.effect("turning close-to-tray off removes the tray so closing the window quits", () =>
    Effect.gen(function* () {
      yield* resetElectron;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.DesktopTray;
          const state = yield* DesktopState.DesktopState;
          yield* tray.start;

          const off = yield* tray.update({ closeToTray: false });
          assert.isFalse(off.closeToTray);
          assert.isFalse(yield* Ref.get(state.trayActive));
          assert.isTrue(electron.trays[0]?.isDestroyed());

          const on = yield* tray.update({ closeToTray: true });
          assert.isTrue(on.closeToTray);
          assert.isTrue(yield* Ref.get(state.trayActive));
          assert.lengthOf(electron.trays, 2);
        }),
      ).pipe(Effect.provide(layerTray()));
    }),
  );

  it.effect("falls back to quitting on close when no tray can be created", () =>
    Effect.gen(function* () {
      yield* resetElectron;
      electron.failTrayCreation = true;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.DesktopTray;
          const state = yield* DesktopState.DesktopState;
          assert.isFalse(yield* tray.start);
          assert.isFalse(yield* Ref.get(state.trayActive));
          assert.isTrue((yield* tray.settings).closeToTray);
        }),
      ).pipe(
        Effect.provide(
          layerTray({
            settings: { ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS, launchAtLogin: true },
          }),
        ),
        Effect.provideService(HostProcess.Arguments, ["t3code.exe", LAUNCH_HIDDEN_ARGUMENT]),
      );
    }),
  );

  it.effect("starts hidden in the tray when launched at login", () =>
    Effect.gen(function* () {
      yield* resetElectron;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.DesktopTray;
          const state = yield* DesktopState.DesktopState;
          assert.isTrue(yield* tray.start);
          assert.isTrue(yield* Ref.get(state.mainHiddenInTray));
        }),
      ).pipe(
        Effect.provide(
          layerTray({
            settings: { ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS, launchAtLogin: true },
          }),
        ),
        Effect.provideService(HostProcess.Arguments, ["t3code.exe", LAUNCH_HIDDEN_ARGUMENT]),
      );
    }),
  );

  it.effect("changes the login item only when the setting changes, and removes it again", () =>
    Effect.gen(function* () {
      yield* resetElectron;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const tray = yield* DesktopTray.DesktopTray;
          yield* tray.start;
          assert.deepEqual(electron.loginItems, [], "startup never touches the login item");

          assert.isTrue((yield* tray.update({ launchAtLogin: true })).launchAtLogin);
          yield* tray.update({ launchAtLogin: true });
          assert.isFalse((yield* tray.update({ launchAtLogin: false })).launchAtLogin);

          assert.deepEqual(electron.loginItems, [
            { openAtLogin: true, openAsHidden: true, args: [LAUNCH_HIDDEN_ARGUMENT] },
            { openAtLogin: false, openAsHidden: true, args: [LAUNCH_HIDDEN_ARGUMENT] },
          ]);
        }),
      ).pipe(Effect.provide(layerTray()));
    }),
  );
});
