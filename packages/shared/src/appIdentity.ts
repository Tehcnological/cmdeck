// CMDeck fork identity: what makes this build a separate app from the official T3 Code.
// Upstream's values are kept beside ours for `cmdeck import-from-t3`, which reads them explicitly.
// See docs/operations/fork-upstream-sync.md ("Renamed in this fork").

export const APP_DISPLAY_NAME = "CMDeck";
export const APP_CLI_NAME = "cmdeck";

/** Default data directory under the user's home. */
export const APP_HOME_DIR_NAME = ".cmdeck";
export const UPSTREAM_HOME_DIR_NAME = ".t3";

/**
 * Wins over `T3CODE_HOME`, which every reader still uses (kept for merges with upstream). A
 * `T3CODE_HOME` naming the official home is ignored; see `applyAppHomeEnv`.
 */
export const APP_HOME_ENV = "CMDECK_HOME";
export const UPSTREAM_HOME_ENV = "T3CODE_HOME";

export const DESKTOP_APP_ID = "com.tehcnological.cmdeck";
export const DESKTOP_DEV_APP_ID = "com.tehcnological.cmdeck.dev";
/** Electron profile folders under the OS app-data directory. */
export const DESKTOP_USER_DATA_DIR_NAME = "cmdeck";
/** Staged package name: NSIS installs to `%LOCALAPPDATA%\Programs\<name>`; electron-updater caches in `<name>-updater`. */
export const DESKTOP_PACKAGE_NAME = "cmdeck";
/** Carried by every `cmdeck`/`t3` launcher the desktop app writes; uninstall removes only launchers with it. */
export const CLI_SHIM_MARKER = "Written by CMDeck: runs the desktop app's bundled t3 CLI.";
export const DESKTOP_DEV_USER_DATA_DIR_NAME = "cmdeck-dev";

/** systemd unit, Task Scheduler task and folder stem of the background service. */
export const SERVICE_NAME = "cmdeck";
export const SERVICE_LAUNCHD_LABEL = "com.tehcnological.cmdeck.service";

/**
 * The only release feed CMDeck installers update from: this repository's stable GitHub releases.
 * Release vN is app version N.0.0. Never point this at upstream.
 */
export const APP_RELEASE_OWNER = "Tehcnological";
export const APP_RELEASE_REPO = "cmdeck";
export const APP_RELEASE_REPOSITORY = `${APP_RELEASE_OWNER}/${APP_RELEASE_REPO}`;

const RELEASE_VERSION = /^([1-9]\d*)\.0\.0(-beta\.[1-9]\d*)?$/u;

/** Shows release N.0.0 as `vN` and beta N.0.0-beta.M as `vN-beta.M`, which are also their tags;
 * any other version (dev, nightly) unchanged. */
export const formatAppVersion = (version: string): string => {
  const match = RELEASE_VERSION.exec(version);
  return match === null ? version : `v${match[1]}${match[2] ?? ""}`;
};

/** The git tag of a version's release: `vN` for N.0.0, else `v<version>`. */
export const appReleaseTag = (version: string): string => {
  const formatted = formatAppVersion(version);
  return formatted === version ? `v${version}` : formatted;
};

/** Official T3 Code uses 3773; a different default keeps both servers on stable ports. */
export const DEFAULT_SERVER_PORT = 3783;

/** How this host spells paths; `resolve` makes a path absolute, as `node:path` does. */
export interface HomePathHost {
  readonly homeDir: string;
  readonly platform: string;
  readonly resolve: (path: string) => string;
}

function comparableHome(value: string, host: HomePathHost): string {
  const expanded = value === "~" || /^~[/\\]/u.test(value) ? host.homeDir + value.slice(1) : value;
  const absolute = host.resolve(expanded);
  // Windows and macOS file systems ignore case by default.
  const foldCase = host.platform === "win32" || host.platform === "darwin";
  return foldCase ? absolute.toLowerCase() : absolute;
}

/**
 * Copies `CMDECK_HOME` into `T3CODE_HOME` so it wins and child processes inherit it. Without it, a
 * `T3CODE_HOME` set for the official T3 Code (`~/.t3`) is removed, so CMDeck never opens that
 * database or its signing keys; other values, such as a test's temporary folder, still apply.
 * Returns the removed value so the caller can warn.
 */
export function applyAppHomeEnv(
  env: Record<string, string | undefined>,
  host: HomePathHost,
): string | undefined {
  const home = env[APP_HOME_ENV]?.trim();
  if (home) {
    env[UPSTREAM_HOME_ENV] = home;
    return undefined;
  }
  const upstream = env[UPSTREAM_HOME_ENV]?.trim();
  const official = comparableHome(`~/${UPSTREAM_HOME_DIR_NAME}`, host);
  if (!upstream || comparableHome(upstream, host) !== official) return undefined;
  Reflect.deleteProperty(env, UPSTREAM_HOME_ENV);
  return upstream;
}

export const ignoredOfficialHomeWarning = (value: string): string =>
  `Ignoring ${UPSTREAM_HOME_ENV}=${value}: it is the official T3 Code data directory, which CMDeck never uses. Set ${APP_HOME_ENV} to choose CMDeck's data directory.`;
