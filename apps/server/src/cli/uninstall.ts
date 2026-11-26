// @effect-diagnostics nodeBuiltinImport:off
// Windows cleanup must outlive this executable to delete its directory; scoped ChildProcess kills children on exit.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";

import * as BootService from "../cloud/bootService.ts";
import {
  findPosixLauncher,
  generatedWindowsShimTarget,
  isVersionExecutable,
  pinnedRuntimeVersionsDir,
  readPosixLauncherTarget,
  resolveLauncherPath,
} from "../cloud/pinnedRuntime.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as CliService from "./service.ts";
import { awaitDetachedSpawn } from "../process/windowsVerbatimSpawn.ts";
import { windowsPowerShellPath, windowsSystem32Path } from "@t3tools/shared/windowsSystem";
import { WINDOWS_USER_PATH_SCRIPT } from "@t3tools/shared/windowsUserPath";
import {
  assertStillPlanned,
  planUninstall as planCompleteUninstall,
  removePlannedPath,
  UninstallTargetChangedError,
  type UninstallAction,
  type UninstallPlanInput,
} from "@t3tools/shared/uninstallPlan";
import { findWindowsShim } from "./update.ts";

export class CliUninstallError extends Schema.TaggedError<CliUninstallError>()(
  "CliUninstallError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface UninstallPlan {
  readonly service: boolean;
  readonly otherHomeService: string | undefined;
  readonly versionsDir: string;
  readonly launchers: ReadonlyArray<string>;
  readonly runtimeDir: string | undefined;
  readonly userdataDir: string;
}

/** Delete only launchers targeting this home's runtime/versions. */
export const findOwnedLauncher = Effect.fn("cli.uninstall.find_launcher")(function* (input: {
  readonly launchedAs: string | undefined;
  readonly versionsDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  if (input.launchedAs === undefined) return undefined;
  if (platform === "win32") {
    const shimPath = yield* findWindowsShim(input.launchedAs);
    if (shimPath === undefined) return undefined;
    const contents = yield* fs.readFileString(shimPath).pipe(Effect.option);
    const target = Option.isSome(contents) ? generatedWindowsShimTarget(contents.value) : undefined;
    return target !== undefined && isVersionExecutable(path, input.versionsDir, target)
      ? shimPath
      : undefined;
  }
  return yield* findPosixLauncher({ launchedAs: input.launchedAs, versionsDir: input.versionsDir });
});

/** Whether `launcher` is a link, unedited `t3` script, or unedited `t3.cmd` into this home's runtime/versions. */
const ownsLauncher = Effect.fn("cli.uninstall.owns_launcher")(function* (
  launcher: string,
  versionsDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const realVersionsDir = yield* fs
    .realPath(versionsDir)
    .pipe(Effect.orElseSucceed(() => versionsDir));
  const scriptTarget = platform === "win32" ? undefined : yield* readPosixLauncherTarget(launcher);
  // The link or script text keeps a pruned (dangling) target; the real path sees through a
  // symlinked T3 home.
  const targets =
    platform === "win32"
      ? [
          yield* fs.readFileString(launcher).pipe(
            Effect.map(generatedWindowsShimTarget),
            Effect.orElseSucceed(() => undefined),
          ),
        ]
      : [
          yield* fs.readLink(launcher).pipe(
            Effect.map((link) => path.resolve(path.dirname(launcher), link)),
            Effect.orElseSucceed(() => undefined),
          ),
          yield* fs.realPath(launcher).pipe(Effect.orElseSucceed(() => undefined)),
          scriptTarget,
          scriptTarget !== undefined
            ? yield* fs.realPath(scriptTarget).pipe(Effect.orElseSucceed(() => undefined))
            : undefined,
        ];
  return targets.some(
    (target) =>
      target !== undefined &&
      (isVersionExecutable(path, versionsDir, target) ||
        isVersionExecutable(path, realVersionsDir, target)),
  );
});

/**
 * Launchers recorded in `runtime/launchers` by the install scripts and `t3 install` that still
 * point into this home's runtime/versions. npx can run a different version than the installed
 * one, so the launcher this process started from does not always name them.
 */
export const findRecordedLaunchers = Effect.fn("cli.uninstall.find_recorded_launchers")(function* (
  versionsDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recorded = yield* fs
    .readFileString(path.join(path.dirname(versionsDir), "launchers"))
    .pipe(Effect.orElseSucceed(() => ""));
  const owned: Array<string> = [];
  for (const launcher of recorded.split(/\r?\n/).filter(Boolean)) {
    if (yield* ownsLauncher(launcher, versionsDir)) owned.push(launcher);
  }
  return owned;
});

// cmd.exe needs verbatim quoting and literal paths, with delayed expansion disabled. The shell
// starts in System32 and runs ping from there, whatever directory `t3 uninstall` was run in.
export function spawnWindowsRemoval(environment: NodeJS.ProcessEnv, dir: string) {
  const ping = windowsSystem32Path(environment, "ping.exe");
  return NodeChildProcess.spawn(
    environment["ComSpec"] ?? environment["COMSPEC"] ?? windowsSystem32Path(environment, "cmd.exe"),
    [
      "/d",
      "/v:off",
      "/s",
      "/c",
      '""%T3_UNINSTALL_PING%" -n 3 127.0.0.1 >nul & rmdir /s /q "%T3_UNINSTALL_RUNTIME%""',
    ],
    {
      cwd: NodePath.win32.dirname(ping),
      env: { ...process.env, T3_UNINSTALL_PING: ping, T3_UNINSTALL_RUNTIME: dir },
      windowsVerbatimArguments: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

const planUninstall = Effect.fn("cli.uninstall.plan")(function* (input: {
  readonly baseDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  const installedBaseDir =
    status.supported && status.installed ? status.installedBaseDir : undefined;
  const servesThisHome = installedBaseDir !== undefined && status.otherBaseDir === undefined;
  const versionsDir = pinnedRuntimeVersionsDir(path, input.baseDir);
  const runtimeDir = path.dirname(versionsDir);
  const launchedAs = (yield* HostProcess.IsExecutable) ? yield* resolveLauncherPath : undefined;
  const launchedFrom = yield* findOwnedLauncher({ launchedAs, versionsDir });
  const plan: UninstallPlan = {
    service: servesThisHome,
    otherHomeService: servesThisHome ? undefined : installedBaseDir,
    versionsDir,
    launchers: [
      ...new Set([
        ...(launchedFrom === undefined ? [] : [launchedFrom]),
        ...(yield* findRecordedLaunchers(versionsDir)),
      ]),
    ],
    runtimeDir: (yield* fs.exists(runtimeDir).pipe(Effect.orElseSucceed(() => false)))
      ? runtimeDir
      : undefined,
    userdataDir: path.join(input.baseDir, "userdata"),
  };
  return plan;
});

export const uninstallCommand = Command.make("uninstall", {
  ...projectLocationFlags,
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription(
      "Remove everything without asking. Required from a script, where there is no prompt.",
    ),
    Flag.withDefault(false),
  ),
  app: Flag.Boolean("app").pipe(
    Flag.withDescription(
      "Also remove the CMDeck desktop app, its cmdeck/t3 commands and the PATH entry it added. Your threads and settings are kept.",
    ),
    Flag.withDefault(false),
  ),
  all: Flag.Boolean("all").pipe(
    Flag.withDescription(
      "Everything --app removes, plus all CMDeck data: threads, settings, sign-ins and caches. Never touches the official T3 Code, your projects, or provider settings.",
    ),
    Flag.withDefault(false),
  ),
  includeDev: Flag.Boolean("include-dev").pipe(
    Flag.withDescription("With --all, also remove the development build's profile (cmdeck-dev)."),
    Flag.withDefault(false),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Only list what would be removed."),
    Flag.withDefault(false),
  ),
  // The desktop app quits and hands the rest to this command; its profile is locked until then.
  waitPid: Flag.Int("wait-pid").pipe(Flag.withHidden, Flag.optional),
}).pipe(
  Command.withDescription(
    "Remove CMDeck from this machine: the background service, the launcher, and every downloaded version. Your projects and threads are kept unless you pass --all.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      return yield* runUninstall({
        baseDir: config.baseDir,
        assumeYes: flags.yes,
        app: flags.app || flags.all,
        removeData: flags.all,
        includeDevProfile: flags.all && flags.includeDev,
        dryRun: flags.dryRun,
        waitPid: Option.getOrUndefined(flags.waitPid),
      }).pipe(Effect.provide(CliService.layer(config)));
    }),
  ),
);

const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const isTargetChanged = Schema.is(UninstallTargetChangedError);

const describeAction = (action: UninstallAction) => {
  switch (action.kind) {
    case "stop-service":
      return undefined;
    case "remove-launcher":
      return `the launcher at ${action.target}`;
    case "remove-path-entry":
      return `${action.target} from your PATH`;
    case "run-app-uninstaller":
      return `the CMDeck desktop app, with its own uninstaller (${action.target})`;
    case "remove-app":
      return `the CMDeck desktop app at ${action.target}`;
    case "remove-app-manually":
      return undefined;
    case "remove-data":
      return action.target;
  }
};

/** Runs PowerShell's registry script; the CLI has no desktop shell to inherit PATH changes from. */
const windowsUserPath = (environment: NodeJS.ProcessEnv, overrides: Record<string, string>) =>
  Effect.try({
    try: () =>
      NodeChildProcess.execFileSync(
        windowsPowerShellPath(environment),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_USER_PATH_SCRIPT],
        { env: { ...process.env, ...overrides }, encoding: "utf8", windowsHide: true },
      ),
    catch: () =>
      new CliUninstallError({ reason: "Could not update your PATH, so it was left unchanged." }),
  });

const removeWindowsPathEntry = Effect.fn("cli.uninstall.remove_path_entry")(function* (
  environment: NodeJS.ProcessEnv,
  entry: string,
) {
  const same = (value: string) =>
    value.replace(/[\\/]+$/u, "").toLowerCase() === entry.replace(/[\\/]+$/u, "").toLowerCase();
  const encoded = yield* windowsUserPath(environment, { T3_SET: "0" });
  const entries = Buffer.from(encoded.trim(), "base64").toString("utf8").split(";").filter(Boolean);
  const kept = entries.filter((value) => !same(value));
  if (kept.length !== entries.length) {
    yield* windowsUserPath(environment, { T3_SET: "1", T3_PATH: kept.join(";") });
  }
});

const logOtherHomeService = (plan: UninstallPlan) =>
  plan.otherHomeService === undefined
    ? Effect.void
    : Console.log(
        `The CMDeck service serves ${plan.otherHomeService}, so it was not removed. Pass \`${BootService.formatBootServiceBaseDirOption(plan.otherHomeService)}\` to remove it.`,
      );

const runUninstall = Effect.fn("cli.uninstall.run")(function* (input: {
  readonly baseDir: string;
  readonly assumeYes: boolean;
  readonly app: boolean;
  readonly removeData: boolean;
  readonly includeDevProfile: boolean;
  readonly dryRun: boolean;
  readonly waitPid: number | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const service = yield* BootService.BootService;
  if (input.waitPid !== undefined) {
    for (let tries = 0; tries < 600 && processAlive(input.waitPid); tries++) {
      yield* Effect.sleep("100 millis");
    }
  }
  const plan = yield* planUninstall({ baseDir: input.baseDir });
  const completeInput: UninstallPlanInput = {
    platform,
    homeDir: yield* HostProcess.HomeDirectory,
    env: environment,
    dataDir: input.baseDir,
    removeData: input.removeData,
    includeDevProfile: input.includeDevProfile,
  };
  const complete = input.app
    ? planCompleteUninstall(completeInput)
    : { dataDir: input.baseDir, actions: [], refusals: [] };
  const completeSteps = complete.actions.filter(
    (action) =>
      action.kind !== "stop-service" &&
      !(action.kind === "remove-launcher" && plan.launchers.includes(action.target)),
  );
  const removesDataDir = completeSteps.some(
    (action) => action.kind === "remove-data" && action.target === complete.dataDir,
  );
  const runtimeDir = removesDataDir ? undefined : plan.runtimeDir;

  if (
    !plan.service &&
    plan.launchers.length === 0 &&
    runtimeDir === undefined &&
    completeSteps.length === 0
  ) {
    yield* Console.log(`Nothing to remove: CMDeck is not installed for ${input.baseDir}.`);
    for (const refusal of complete.refusals) yield* Console.log(refusal);
    if (!(yield* HostProcess.IsExecutable) && !input.app) {
      yield* Console.log(
        "  This t3 runs from a Node script, so it was installed by npm or built from source. Remove it the same way (`npm uninstall -g t3`, or delete the checkout).",
      );
    }
    yield* logOtherHomeService(plan);
    return;
  }

  yield* Console.log("This will remove:");
  if (plan.service) yield* Console.log("  the background service (stopping it first)");
  for (const launcher of plan.launchers) yield* Console.log(`  the launcher at ${launcher}`);
  if (runtimeDir !== undefined) {
    yield* Console.log(`  every downloaded version under ${runtimeDir}`);
  }
  for (const action of completeSteps) {
    const line = describeAction(action);
    if (line !== undefined) yield* Console.log(`  ${line}`);
  }
  for (const refusal of complete.refusals) yield* Console.log(refusal);
  if (!input.removeData) {
    yield* Console.log(
      `Your projects, threads, and settings under ${plan.userdataDir} are kept. Pass --all to remove them too.`,
    );
  } else {
    yield* Console.log(
      "Your projects, the official T3 Code and your providers' own settings are never touched.",
    );
  }
  if (input.dryRun) {
    yield* Console.log("Dry run: nothing was removed.");
    return;
  }

  if (!input.assumeYes) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      return yield* new CliUninstallError({
        reason:
          "Not a terminal, so nothing was removed. Rerun with --yes to confirm from a script.",
      });
    }
    const confirmed = yield* Prompt.run(
      Prompt.Confirm({
        message: input.removeData
          ? "Remove CMDeck and all its data from this machine?"
          : "Remove CMDeck from this machine?",
        initial: false,
      }),
    ).pipe(Effect.catchTags({ QuitError: () => Effect.succeed(false) }));
    if (!confirmed) {
      yield* Console.log("Left as is.");
      return;
    }
  }

  // The prompt can wait a long time; keep a service or launcher that changed hands meanwhile.
  if (plan.service && (yield* service.status).otherBaseDir !== undefined) {
    yield* Console.log("Left the background service: it now serves another CMDeck data folder.");
  } else if (plan.service) {
    yield* service.uninstall;
    yield* Console.log("Removed the background service.");
  }
  for (const launcher of plan.launchers) {
    if (!(yield* ownsLauncher(launcher, plan.versionsDir))) {
      yield* Console.log(`Left ${launcher}: it no longer runs this t3.`);
      continue;
    }
    yield* fs
      .remove(launcher, { force: true })
      .pipe(
        Effect.mapError(
          () => new CliUninstallError({ reason: `Could not remove the launcher at ${launcher}.` }),
        ),
      );
    yield* Console.log(`Removed ${launcher}.`);
  }

  // Each step plans again first, so anything that changed since the prompt is left alone.
  const stillPlanned = (action: UninstallAction) =>
    Effect.try({
      try: () => assertStillPlanned(completeInput, action),
      catch: (error) =>
        isTargetChanged(error)
          ? error
          : new CliUninstallError({ reason: `Could not check ${action.target}.` }),
    });
  const removeStep = (action: UninstallAction) =>
    Effect.try({
      try: () => removePlannedPath(completeInput, action),
      catch: (error) =>
        isTargetChanged(error)
          ? error
          : new CliUninstallError({ reason: `Could not remove ${action.target}.` }),
    }).pipe(Effect.andThen(Console.log(`Removed ${action.target}.`)));
  const runStep = Effect.fn("cli.uninstall.run_step")(
    function* (action: UninstallAction) {
      switch (action.kind) {
        case "remove-launcher":
        case "remove-app":
          return yield* removeStep(action);
        case "remove-path-entry":
          yield* stillPlanned(action);
          yield* removeWindowsPathEntry(environment, action.target);
          yield* fs
            .remove(path.join(complete.dataDir, "userdata", "cli-command-path-entry"), {
              force: true,
            })
            .pipe(Effect.ignore);
          return yield* Console.log(`Removed ${action.target} from your PATH.`);
        case "remove-data": {
          const execPath = yield* HostProcess.ExecutablePath;
          const relative = path.relative(action.target.toLowerCase(), execPath.toLowerCase());
          const runsFromTarget =
            platform === "win32" &&
            !path.isAbsolute(relative) &&
            relative.split(/[\\/]/u)[0] !== "..";
          if (!runsFromTarget) return yield* removeStep(action);
          // Windows refuses to unlink this running executable; a detached shell removes it after exit.
          yield* stillPlanned(action);
          yield* awaitDetachedSpawn(() => spawnWindowsRemoval(environment, action.target)).pipe(
            Effect.mapError(
              () =>
                new CliUninstallError({
                  reason: `Could not schedule removal of ${action.target}. Delete it yourself once this window is closed.`,
                }),
            ),
          );
          return yield* Console.log(`${action.target} will be removed once this command exits.`);
        }
        default:
          return;
      }
    },
    Effect.catchIf(isTargetChanged, (error) => Console.log(error.message)),
  );
  const order: ReadonlyArray<UninstallAction["kind"]> = [
    "remove-launcher",
    "remove-path-entry",
    "remove-data",
    "remove-app",
  ];
  for (const kind of order) {
    for (const action of completeSteps.filter((step) => step.kind === kind)) {
      yield* runStep(action);
    }
  }

  if (runtimeDir !== undefined) {
    // Windows refuses to unlink this running executable; a detached shell removes it after exit.
    if (platform === "win32") {
      const notScheduled = () =>
        new CliUninstallError({
          reason: `Could not schedule removal of ${runtimeDir}. Delete it yourself once this window is closed.`,
        });
      yield* awaitDetachedSpawn(() => spawnWindowsRemoval(environment, runtimeDir)).pipe(
        Effect.mapError(notScheduled),
      );
      yield* Console.log(`${runtimeDir} will be removed once t3 exits.`);
    } else {
      yield* fs
        .remove(runtimeDir, { recursive: true, force: true })
        .pipe(
          Effect.mapError(
            () => new CliUninstallError({ reason: `Could not remove ${runtimeDir}.` }),
          ),
        );
      yield* Console.log(`Removed ${runtimeDir}.`);
    }
  }

  for (const action of completeSteps) {
    if (action.kind !== "remove-app-manually") continue;
    yield* Console.log(
      action.target === ""
        ? "Remove the CMDeck desktop app yourself: delete its AppImage, or run `sudo apt remove cmdeck` if you installed the .deb package."
        : `Remove the CMDeck desktop app yourself: delete ${action.target}, or run \`sudo apt remove cmdeck\` if you installed the .deb package.`,
    );
  }
  // Last: the uninstaller removes the app this command may be running from, after it exits.
  for (const action of completeSteps) {
    if (action.kind !== "run-app-uninstaller") continue;
    yield* stillPlanned(action).pipe(
      Effect.andThen(
        awaitDetachedSpawn(() =>
          NodeChildProcess.spawn(action.target, [], {
            cwd: path.dirname(action.target),
            detached: true,
            stdio: "ignore",
          }),
        ),
      ),
      Effect.andThen(Console.log("The CMDeck uninstaller is open to remove the desktop app.")),
      Effect.catchIf(
        (error) => isTargetChanged(error),
        (error) => Console.log(error.message),
      ),
      Effect.mapError(
        () =>
          new CliUninstallError({ reason: `Could not start ${action.target}. Run it yourself.` }),
      ),
    );
  }
  yield* Console.log("");
  yield* Console.log("CMDeck is uninstalled. Thanks for trying CMDeck.");
  yield* logOtherHomeService(plan);
});
