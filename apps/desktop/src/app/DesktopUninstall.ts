// @effect-diagnostics nodeBuiltinImport:off
// The helper must outlive this process: the Electron profile and Windows install stay locked until it exits.
import * as NodeChildProcess from "node:child_process";

import type { DesktopUninstallOptions, DesktopUninstallPlan } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { planUninstall } from "@t3tools/shared/uninstallPlan";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopBackendManager from "../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { SERVER_ENTRY } from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";

const { logInfo } = makeComponentLogger("desktop-uninstall");

export class DesktopUninstallError extends Schema.TaggedError<DesktopUninstallError>()(
  "DesktopUninstallError",
  { message: Schema.String },
) {}

export class DesktopUninstall extends Context.Service<
  DesktopUninstall,
  {
    readonly getPlan: (options: DesktopUninstallOptions) => Effect.Effect<DesktopUninstallPlan>;
    /** Stops the backends, hands the plan to the bundled CLI, and quits. */
    readonly run: (options: DesktopUninstallOptions) => Effect.Effect<void, DesktopUninstallError>;
  }
>()("@t3tools/desktop/app/DesktopUninstall") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const electronApp = yield* ElectronApp.ElectronApp;
  const env = yield* HostProcess.Environment;

  const getPlan = (options: DesktopUninstallOptions) =>
    Effect.sync((): DesktopUninstallPlan => {
      const plan = planUninstall({
        platform: environment.platform,
        homeDir: environment.homeDirectory,
        env,
        dataDir: environment.baseDir,
        removeData: options.removeData,
      });
      return { supported: environment.isPackaged, actions: plan.actions, refusals: plan.refusals };
    }).pipe(Effect.withSpan("desktop.uninstall.getPlan"));

  // The CLI plans again after this process exits and re-checks every path before removing it.
  const spawnHelper = (options: DesktopUninstallOptions) =>
    Effect.callback<void, DesktopUninstallError>((resume) => {
      const child = NodeChildProcess.spawn(
        process.execPath,
        [
          environment.path.join(environment.serverRoot, SERVER_ENTRY),
          "uninstall",
          "--yes",
          options.removeData ? "--all" : "--app",
          "--wait-pid",
          String(process.pid),
          "--base-dir",
          environment.baseDir,
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.once("error", (error) =>
        resume(
          Effect.fail(
            new DesktopUninstallError({
              message: `Could not start the uninstall: ${error.message}`,
            }),
          ),
        ),
      );
      child.once("spawn", () => {
        child.unref();
        resume(Effect.void);
      });
    });

  const run = Effect.fn("desktop.uninstall.run")(function* (options: DesktopUninstallOptions) {
    if (!environment.isPackaged) {
      return yield* new DesktopUninstallError({
        message: "Development builds cannot uninstall themselves.",
      });
    }
    yield* logInfo("handing the uninstall to the bundled CLI", {
      removeData: options.removeData,
    });
    // The helper waits for this process to exit, so a failed start leaves the app running.
    yield* spawnHelper(options);
    // SQLite and logs must close before their folder is removed.
    const instances = yield* backendPool.list;
    yield* Effect.forEach(
      instances,
      (instance) =>
        instance
          .stop({ timeout: DesktopBackendManager.BACKEND_QUIT_STOP_TIMEOUT })
          .pipe(Effect.ignore),
      { concurrency: "unbounded" },
    );
    yield* shutdown.request;
    yield* electronApp.quit;
  });

  return DesktopUninstall.of({ getPlan, run });
});

export const layer = Layer.effect(DesktopUninstall, make);
