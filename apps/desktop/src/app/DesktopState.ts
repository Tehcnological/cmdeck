import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { BackendStartupFailure } from "../backend/DesktopBackendManager.ts";

/** Startup health of the primary local backend, read by the startup recovery window. */
export type PrimaryBackendStartup =
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Ready" }
  | ({ readonly _tag: "Failing" } & BackendStartupFailure);

export class DesktopState extends Context.Service<
  DesktopState,
  {
    readonly backendReady: Ref.Ref<boolean>;
    readonly quitting: Ref.Ref<boolean>;
    // Set by DesktopUpdates.configure, which runs before the first backend start.
    readonly canInstallUpdates: Ref.Ref<boolean>;
    readonly primaryBackendStartup: SubscriptionRef.SubscriptionRef<PrimaryBackendStartup>;
    // A tray icon exists and close-to-tray is on, so closing every window keeps the app running.
    readonly trayActive: Ref.Ref<boolean>;
    // The user sent the app to the tray; backend readiness must not reopen the main window.
    readonly mainHiddenInTray: Ref.Ref<boolean>;
  }
>()("@t3tools/desktop/app/DesktopState") {}

const make = Effect.all({
  backendReady: Ref.make(false),
  quitting: Ref.make(false),
  canInstallUpdates: Ref.make(false),
  primaryBackendStartup: SubscriptionRef.make<PrimaryBackendStartup>({ _tag: "Starting" }),
  trayActive: Ref.make(false),
  mainHiddenInTray: Ref.make(false),
});

export const layer = Layer.effect(DesktopState, make);
