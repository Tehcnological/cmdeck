// @effect-diagnostics nodeBuiltinImport:off - plans and removes real files; tests run it on temp folders.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import {
  APP_DISPLAY_NAME,
  APP_HOME_DIR_NAME,
  APP_HOME_ENV,
  CLI_SHIM_MARKER,
  DESKTOP_APP_ID,
  DESKTOP_DEV_USER_DATA_DIR_NAME,
  DESKTOP_PACKAGE_NAME,
  DESKTOP_USER_DATA_DIR_NAME,
  SERVICE_LAUNCHD_LABEL,
  SERVICE_NAME,
  UPSTREAM_HOME_DIR_NAME,
  UPSTREAM_HOME_ENV,
} from "./appIdentity.ts";

/**
 * One step of a complete uninstall. Every path is built from CMDeck's identity constants and
 * checked by `planUninstall`; nothing else is ever removed.
 */
export type UninstallAction =
  /** Stop and unregister the background service whose unit, plist or task file is `target`. */
  | { readonly kind: "stop-service"; readonly target: string }
  /** A `cmdeck`/`t3` launcher file or link carrying CMDeck's marker. */
  | { readonly kind: "remove-launcher"; readonly target: string }
  /** Windows: the user PATH entry (CMDeck's bin folder) the app recorded adding. */
  | { readonly kind: "remove-path-entry"; readonly target: string }
  /** Windows: the installed app's own NSIS uninstaller, run after CMDeck exits. */
  | { readonly kind: "run-app-uninstaller"; readonly target: string }
  /** macOS: an app bundle whose bundle ID is CMDeck's. */
  | { readonly kind: "remove-app"; readonly target: string }
  /** Linux: the AppImage or package is left to the user; `target` is the running AppImage, if any. */
  | { readonly kind: "remove-app-manually"; readonly target: string }
  /** A folder or file holding CMDeck's data: the data folder, Electron profile, caches. */
  | { readonly kind: "remove-data"; readonly target: string };

export interface UninstallPlan {
  readonly dataDir: string;
  readonly actions: ReadonlyArray<UninstallAction>;
  /** Paths that looked like CMDeck's but failed a safety check, with the reason. They are kept. */
  readonly refusals: ReadonlyArray<string>;
}

export interface UninstallPlanInput {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** CMDeck's resolved data folder (`CMDECK_HOME`, else `~/.cmdeck`). */
  readonly dataDir: string;
  /** Also remove the data folder, Electron profile and caches (threads, settings, sign-ins). */
  readonly removeData: boolean;
  /** Also remove the development profile (`cmdeck-dev`); only with `removeData`. */
  readonly includeDevProfile?: boolean;
}

const MAX_LAUNCHER_BYTES = 16_384;
/** Never removed, nor anything inside or above them: the official app's and providers' own state. */
const PROTECTED_HOME_ENTRIES = [
  UPSTREAM_HOME_DIR_NAME,
  ".claude",
  ".codex",
  ".gemini",
  ".cursor",
  ".kiro",
  ".grok",
  ".pi",
  ".ssh",
  ".aws",
];
/** The official T3 Code's names; no path component may carry one. */
const OFFICIAL_NAME = /^\.t3$|t3code|com\.t3tools|^t3 code/iu;

const lstat = (target: string) => {
  try {
    return NodeFS.lstatSync(target);
  } catch {
    return undefined;
  }
};
const realPath = (target: string) => {
  try {
    return NodeFS.realpathSync.native(target);
  } catch {
    return undefined;
  }
};
const readSmallFile = (target: string) => {
  try {
    const info = NodeFS.statSync(target);
    if (!info.isFile() || info.size > MAX_LAUNCHER_BYTES) return undefined;
    return NodeFS.readFileSync(target, "utf8");
  } catch {
    return undefined;
  }
};
const listDir = (target: string) => {
  try {
    return NodeFS.readdirSync(target);
  } catch {
    return [];
  }
};

function makeContext(input: UninstallPlanInput) {
  const path = input.platform === "win32" ? NodePath.win32 : NodePath.posix;
  const foldCase = input.platform === "win32" || input.platform === "darwin";
  const key = (target: string) => {
    const resolved = path.resolve(target).replace(/[\\/]+$/u, "");
    return foldCase ? resolved.toLowerCase() : resolved;
  };
  /** Whether `child` is `parent` or inside it. */
  const within = (child: string, parent: string) => {
    const relative = path.relative(key(parent), key(child));
    return relative === "" || (relative.split(/[\\/]/u)[0] !== ".." && !path.isAbsolute(relative));
  };
  const env = input.env;
  const home = path.resolve(input.homeDir);
  const absoluteEnv = (name: string) => {
    const value = env[name]?.trim();
    return value && path.isAbsolute(value) ? value : undefined;
  };
  const appData =
    input.platform === "win32"
      ? (absoluteEnv("APPDATA") ?? path.join(home, "AppData", "Roaming"))
      : input.platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : (absoluteEnv("XDG_CONFIG_HOME") ?? path.join(home, ".config"));
  const localAppData = absoluteEnv("LOCALAPPDATA") ?? path.join(home, "AppData", "Local");
  const dataDir = path.resolve(input.dataDir);

  const explicitHome = env[APP_HOME_ENV]?.trim();
  const upstreamHome = env[UPSTREAM_HOME_ENV]?.trim();
  const protectedRoots = [
    ...PROTECTED_HOME_ENTRIES.map((name) => path.join(home, name)),
    // Without CMDECK_HOME, T3CODE_HOME may be the official app's folder: never ours to remove.
    ...(upstreamHome &&
    path.isAbsolute(upstreamHome) &&
    (!explicitHome || key(upstreamHome) !== key(explicitHome))
      ? [upstreamHome]
      : []),
  ];
  const withReal = (paths: ReadonlyArray<string>) => [
    ...paths,
    ...paths.flatMap((entry) => realPath(entry) ?? []),
  ];
  const homes = withReal([home]);
  const protectedPaths = withReal(protectedRoots);

  /** Why `target` must never be removed, or undefined when it is safe to. */
  const unsafeReason = (target: string): string | undefined => {
    for (const candidate of [path.resolve(target), realPath(target)]) {
      if (candidate === undefined) continue;
      if (key(candidate) === key(path.parse(candidate).root)) return "it is a filesystem root";
      if (homes.some((entry) => within(entry, candidate)))
        return "it is or contains your home folder";
      const overlap = protectedPaths.find(
        (entry) => within(candidate, entry) || within(entry, candidate),
      );
      if (overlap !== undefined) return `it overlaps ${overlap}, which CMDeck never removes`;
      const relative = homes
        .map((entry) => path.relative(key(entry), key(candidate)))
        .find((value) => !value.startsWith(".."));
      const parts = (relative ?? key(candidate)).split(/[\\/]/u);
      if (parts.some((part) => OFFICIAL_NAME.test(part))) {
        return "its name belongs to the official T3 Code";
      }
    }
    return undefined;
  };

  /** The data folder must be a CMDeck-named folder inside home, also after resolving links. */
  const dataDirReason = (): string | undefined => {
    if (!explicitHome && upstreamHome && key(upstreamHome) === key(dataDir)) {
      return `it came from ${UPSTREAM_HOME_ENV}, which the official T3 Code also reads; set ${APP_HOME_ENV} to remove it`;
    }
    const unsafe = unsafeReason(dataDir);
    if (unsafe !== undefined) return unsafe;
    const real = realPath(dataDir) ?? dataDir;
    const inside = (candidate: string) =>
      homes.some((entry) => within(candidate, entry) && key(candidate) !== key(entry));
    if (!inside(dataDir) || !inside(real)) return "it is outside your home folder";
    if (!/cmdeck/iu.test(path.basename(dataDir)) || !/cmdeck/iu.test(path.basename(real))) {
      return `its name does not look like CMDeck's (default ${APP_HOME_DIR_NAME})`;
    }
    return undefined;
  };

  return {
    path,
    key,
    within,
    home,
    appData,
    localAppData,
    dataDir,
    unsafeReason,
    dataDirReason,
  };
}

/**
 * Lists what a complete uninstall removes. Pure apart from reading the file system: it never
 * changes anything. Callers show the plan, then hand each action to an executor that calls
 * `assertStillPlanned` right before acting.
 */
export function planUninstall(input: UninstallPlanInput): UninstallPlan {
  const ctx = makeContext(input);
  const { path, home, dataDir } = ctx;
  const win = input.platform === "win32";
  const mac = input.platform === "darwin";
  const actions: Array<UninstallAction> = [];
  const refusals: Array<string> = [];
  const exists = (target: string) => lstat(target) !== undefined;
  const add = (action: UninstallAction) => {
    const reason =
      action.kind === "remove-app-manually" ? undefined : ctx.unsafeReason(action.target);
    if (reason !== undefined) {
      refusals.push(`Kept ${action.target}: ${reason}.`);
      return;
    }
    if (
      !actions.some(
        (entry) => entry.kind === action.kind && ctx.key(entry.target) === ctx.key(action.target),
      )
    ) {
      actions.push(action);
    }
  };

  const serviceFile = win
    ? path.join(ctx.localAppData, SERVICE_NAME, `${SERVICE_NAME}-task.xml`)
    : mac
      ? path.join(home, "Library", "LaunchAgents", `${SERVICE_LAUNCHD_LABEL}.plist`)
      : path.join(ctx.appData, "systemd", "user", `${SERVICE_NAME}.service`);
  if (exists(serviceFile)) add({ kind: "stop-service", target: serviceFile });

  const binDir = path.join(dataDir, "bin");
  const realBinDir = realPath(binDir) ?? binDir;
  const launcherNames = win ? ["cmdeck.cmd", "t3.cmd"] : ["cmdeck", "t3"];
  const launcherDirs = [
    binDir,
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    ...(mac ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
  ];
  for (const directory of launcherDirs) {
    for (const name of launcherNames) {
      const launcher = path.join(directory, name);
      if (ownsLauncher(launcher)) add({ kind: "remove-launcher", target: launcher });
    }
  }

  function ownsLauncher(launcher: string): boolean {
    const info = lstat(launcher);
    if (info === undefined) return false;
    if (info.isSymbolicLink()) {
      let linked: string;
      try {
        linked = path.resolve(path.dirname(launcher), NodeFS.readlinkSync(launcher));
      } catch {
        return false;
      }
      const real = realPath(launcher);
      const intoBin =
        ctx.within(linked, binDir) || (real !== undefined && ctx.within(real, realBinDir));
      if (!intoBin) return false;
    } else if (!info.isFile()) {
      return false;
    }
    return readSmallFile(launcher)?.includes(CLI_SHIM_MARKER) ?? false;
  }

  if (win) {
    const marker = path.join(dataDir, "userdata", "cli-command-path-entry");
    const recorded = readSmallFile(marker)?.trim();
    if (recorded !== undefined && ctx.key(recorded) === ctx.key(binDir)) {
      add({ kind: "remove-path-entry", target: binDir });
    }
    const installDir = path.join(ctx.localAppData, "Programs", DESKTOP_PACKAGE_NAME);
    const uninstaller = listDir(installDir).find((name) =>
      new RegExp(`^Uninstall ${APP_DISPLAY_NAME}( \\(\\w+\\))?\\.exe$`, "u").test(name),
    );
    if (uninstaller !== undefined && lstat(path.join(installDir, uninstaller))?.isFile()) {
      add({ kind: "run-app-uninstaller", target: path.join(installDir, uninstaller) });
    }
  } else if (mac) {
    for (const directory of ["/Applications", path.join(home, "Applications")]) {
      for (const name of listDir(directory)) {
        const bundle = path.join(directory, name);
        if (name.startsWith(APP_DISPLAY_NAME) && name.endsWith(".app") && isCmdeckBundle(bundle)) {
          add({ kind: "remove-app", target: bundle });
        }
      }
    }
  } else {
    add({ kind: "remove-app-manually", target: input.env["APPIMAGE"]?.trim() ?? "" });
  }

  if (input.removeData) {
    const dataReason = ctx.dataDirReason();
    if (dataReason !== undefined) {
      refusals.push(`Kept ${dataDir}: ${dataReason}.`);
    } else if (exists(dataDir)) {
      add({ kind: "remove-data", target: dataDir });
    }
    const dataPaths = [
      path.join(ctx.appData, DESKTOP_USER_DATA_DIR_NAME),
      ...(input.includeDevProfile ? [path.join(ctx.appData, DESKTOP_DEV_USER_DATA_DIR_NAME)] : []),
      ...(win
        ? [path.join(ctx.localAppData, `${DESKTOP_PACKAGE_NAME}-updater`)]
        : mac
          ? [
              path.join(home, "Library", "Caches", DESKTOP_APP_ID),
              path.join(home, "Library", "Caches", `${DESKTOP_APP_ID}.ShipIt`),
              path.join(home, "Library", "Caches", `${DESKTOP_PACKAGE_NAME}-updater`),
              path.join(home, "Library", "Preferences", `${DESKTOP_APP_ID}.plist`),
              path.join(home, "Library", "Saved Application State", `${DESKTOP_APP_ID}.savedState`),
              path.join(home, "Library", "HTTPStorages", DESKTOP_APP_ID),
              path.join(home, "Library", "WebKit", DESKTOP_APP_ID),
            ]
          : [
              path.join(
                input.env["XDG_CACHE_HOME"]?.trim() || path.join(home, ".cache"),
                `${DESKTOP_PACKAGE_NAME}-updater`,
              ),
            ]),
    ];
    for (const target of dataPaths) {
      // A profile folder that is a link may lead anywhere; only real folders are CMDeck's.
      const info = lstat(target);
      if (info === undefined) continue;
      if (info.isSymbolicLink()) {
        refusals.push(`Kept ${target}: it is a link.`);
        continue;
      }
      add({ kind: "remove-data", target });
    }
  }

  return { dataDir, actions, refusals };
}

const BUNDLE_ID = new RegExp(
  `<key>CFBundleIdentifier</key>\\s*<string>${DESKTOP_APP_ID.replaceAll(".", "\\.")}</string>`,
  "u",
);

function isCmdeckBundle(bundle: string): boolean {
  const info = lstat(bundle);
  if (info === undefined || info.isSymbolicLink() || !info.isDirectory()) return false;
  try {
    const plist = NodeFS.readFileSync(NodePath.join(bundle, "Contents", "Info.plist"), "utf8");
    return BUNDLE_ID.test(plist);
  } catch {
    return false;
  }
}

export class UninstallTargetChangedError extends Schema.TaggedError<UninstallTargetChangedError>()(
  "UninstallTargetChangedError",
  { target: Schema.String },
) {
  override get message(): string {
    return `Left ${this.target}: it changed since the uninstall plan was made.`;
  }
}

/**
 * Plans again and throws unless `action` is still in the plan. Executors call this immediately
 * before each step, so a link, marker or folder swapped in meanwhile is never acted on.
 */
export function assertStillPlanned(input: UninstallPlanInput, action: UninstallAction): void {
  const fresh = planUninstall(input);
  const key = makeContext(input).key;
  if (
    !fresh.actions.some(
      (entry) =>
        entry.kind === action.kind &&
        (entry.kind === "remove-app-manually" || key(entry.target) === key(action.target)),
    )
  ) {
    throw new UninstallTargetChangedError({ target: action.target });
  }
}

/**
 * Removes a planned launcher, app bundle or data path after re-checking it. Links are removed
 * themselves, never followed, and links inside a removed folder are not followed either.
 */
export function removePlannedPath(input: UninstallPlanInput, action: UninstallAction): void {
  if (
    action.kind !== "remove-launcher" &&
    action.kind !== "remove-data" &&
    action.kind !== "remove-app"
  ) {
    throw new Error(`removePlannedPath cannot run a ${action.kind} step.`);
  }
  assertStillPlanned(input, action);
  NodeFS.rmSync(action.target, { recursive: action.kind !== "remove-launcher", force: true });
}
