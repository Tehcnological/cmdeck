// CMDeck fork identity: what makes this build a separate app from the official T3 Code.
// Upstream's values are kept beside ours for `cmdeck import-from-t3`, which reads them explicitly.
// See docs/operations/fork-upstream-sync.md ("Renamed in this fork").

export const APP_DISPLAY_NAME = "CMDeck";
export const APP_CLI_NAME = "cmdeck";

/** Default data directory under the user's home. */
export const APP_HOME_DIR_NAME = ".cmdeck";
export const UPSTREAM_HOME_DIR_NAME = ".t3";

/** Wins over `T3CODE_HOME`, which every reader still uses (kept for merges with upstream). */
export const APP_HOME_ENV = "CMDECK_HOME";
export const UPSTREAM_HOME_ENV = "T3CODE_HOME";

export const DESKTOP_APP_ID = "com.tehcnological.cmdeck";
export const DESKTOP_DEV_APP_ID = "com.tehcnological.cmdeck.dev";
export const UPSTREAM_DESKTOP_APP_ID = "com.t3tools.t3code";
/** Electron profile folders under the OS app-data directory. */
export const DESKTOP_USER_DATA_DIR_NAME = "cmdeck";
export const DESKTOP_DEV_USER_DATA_DIR_NAME = "cmdeck-dev";
export const UPSTREAM_DESKTOP_USER_DATA_DIR_NAME = "t3code-v2";

/** systemd unit, Task Scheduler task and folder stem of the background service. */
export const SERVICE_NAME = "cmdeck";
export const SERVICE_LAUNCHD_LABEL = "com.tehcnological.cmdeck.service";

/** Official T3 Code uses 3773; a different default keeps both servers on stable ports. */
export const DEFAULT_SERVER_PORT = 3783;

/** Copies `CMDECK_HOME` into `T3CODE_HOME` so it wins and child processes inherit it. */
export function applyAppHomeEnv(env: Record<string, string | undefined>): void {
  const home = env[APP_HOME_ENV]?.trim();
  if (home) env[UPSTREAM_HOME_ENV] = home;
}
