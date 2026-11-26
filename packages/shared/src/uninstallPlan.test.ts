// @effect-diagnostics nodeBuiltinImport:off - builds a fake home on disk for the planner.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CLI_SHIM_MARKER } from "./appIdentity.ts";
import {
  assertStillPlanned,
  planUninstall,
  removePlannedPath,
  UninstallTargetChangedError,
  type UninstallPlanInput,
} from "./uninstallPlan.ts";

// oxlint-disable-next-line t3code/no-global-process-runtime -- The planner reads real temp folders, so it plans for this host.
const platform = process.platform;
const win = platform === "win32";
const mac = platform === "darwin";
const OFFICIAL_MARKER = "Written by T3 Code: runs the desktop app's bundled t3 CLI.";

const roots: Array<string> = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const write = (target: string, content = "x") => {
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.writeFileSync(target, content);
  return target;
};
/** Symlinks need Developer Mode on Windows; directories fall back to a junction. */
const link = (target: string, at: string, type?: "junction") => {
  NodeFS.mkdirSync(NodePath.dirname(at), { recursive: true });
  try {
    NodeFS.symlinkSync(target, at, type);
    return true;
  } catch {
    return false;
  }
};

function makeHome() {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cmdeck-un-")),
  );
  roots.push(root);
  const home = NodePath.join(root, "home");
  const j = (...parts: Array<string>) => NodePath.join(home, ...parts);
  const appData = win
    ? j("AppData", "Roaming")
    : mac
      ? j("Library", "Application Support")
      : j(".config");
  const localAppData = j("AppData", "Local");
  const env: Record<string, string> = win
    ? { APPDATA: appData, LOCALAPPDATA: localAppData }
    : mac
      ? {}
      : { XDG_CONFIG_HOME: appData, XDG_CACHE_HOME: j(".cache") };
  const dataDir = j(".cmdeck");
  const launcher = (dir: string, name: string, marker: string) =>
    write(NodePath.join(dir, win ? `${name}.cmd` : name), `# ${marker}\n`);
  const serviceDir = win
    ? NodePath.join(localAppData)
    : mac
      ? j("Library", "LaunchAgents")
      : NodePath.join(appData, "systemd", "user");

  // Everything the official T3 Code, providers and the user own.
  const foreign = [
    write(j(".t3", "userdata", "state.sqlite")),
    launcher(j(".t3", "bin"), "t3", OFFICIAL_MARKER),
    launcher(j(".local", "bin"), "t3", OFFICIAL_MARKER),
    ...["t3code", "t3code-v2", "t3code-dev", "T3 Code (Alpha)", "T3 Code (Dev)"].map((name) =>
      write(NodePath.join(appData, name, "Local State")),
    ),
    write(j("Library", "Caches", "com.t3tools.t3code", "x")),
    write(j("Library", "Preferences", "com.t3tools.t3code.plist")),
    write(j("Library", "Saved Application State", "com.t3tools.t3code.savedState", "x")),
    write(NodePath.join(localAppData, "t3code-updater", "x")),
    write(NodePath.join(localAppData, "Programs", "t3code", "Uninstall T3 Code.exe")),
    write(
      NodePath.join(
        serviceDir,
        win ? "t3code" : "",
        win ? "t3code-task.xml" : mac ? "com.t3tools.t3code.service.plist" : "t3code.service",
      ),
    ),
    write(j(".claude", "settings.json")),
    write(j(".codex", "config.toml")),
    write(j(".gemini", "settings.json")),
    write(j("projects", "app", "README.md")),
    write(NodePath.join(root, "worktrees", "thread-1", "file.ts")),
  ];

  // CMDeck's own files.
  const cmdeckLauncher = launcher(NodePath.join(dataDir, "bin"), "cmdeck", CLI_SHIM_MARKER);
  const t3Launcher = launcher(NodePath.join(dataDir, "bin"), "t3", CLI_SHIM_MARKER);
  write(NodePath.join(dataDir, "userdata", "statev2.sqlite"));
  const profile = NodePath.dirname(write(NodePath.join(appData, "cmdeck", "Local State")));
  const devProfile = NodePath.dirname(write(NodePath.join(appData, "cmdeck-dev", "Local State")));
  const service = write(
    win
      ? NodePath.join(localAppData, "cmdeck", "cmdeck-task.xml")
      : mac
        ? j("Library", "LaunchAgents", "com.tehcnological.cmdeck.service.plist")
        : NodePath.join(appData, "systemd", "user", "cmdeck.service"),
  );
  return {
    root,
    home,
    j,
    env,
    dataDir,
    foreign,
    cmdeckLauncher,
    t3Launcher,
    profile,
    devProfile,
    service,
    localAppData,
    appData,
  };
}

const input = (fake: ReturnType<typeof makeHome>, overrides: Partial<UninstallPlanInput> = {}) => ({
  platform,
  homeDir: fake.home,
  env: fake.env,
  dataDir: fake.dataDir,
  removeData: true,
  ...overrides,
});
const targets = (plan: ReturnType<typeof planUninstall>) =>
  plan.actions.map((action) => action.target);

describe("planUninstall", () => {
  it("selects only CMDeck's paths next to a full official T3 Code install", () => {
    const fake = makeHome();
    const expected = [
      fake.service,
      fake.cmdeckLauncher,
      fake.t3Launcher,
      fake.dataDir,
      fake.profile,
    ];
    const linkedCmdeck = fake.j(".local", "bin", win ? "cmdeck.cmd" : "cmdeck");
    if (!win && link(fake.cmdeckLauncher, linkedCmdeck)) expected.push(linkedCmdeck);
    if (win) {
      write(
        NodePath.join(fake.dataDir, "userdata", "cli-command-path-entry"),
        `${NodePath.join(fake.dataDir, "bin")}\n`,
      );
      expected.push(NodePath.join(fake.dataDir, "bin"));
      expected.push(
        write(NodePath.join(fake.localAppData, "Programs", "cmdeck", "Uninstall CMDeck.exe")),
      );
      expected.push(
        NodePath.dirname(write(NodePath.join(fake.localAppData, "cmdeck-updater", "x"))),
      );
    }
    if (mac) {
      expected.push(
        NodePath.dirname(write(fake.j("Library", "Caches", "com.tehcnological.cmdeck", "x"))),
      );
    }

    const plan = planUninstall(input(fake));
    const selected = targets(plan).filter((target) => target !== "");
    expect(selected.toSorted()).toEqual(expected.toSorted());
    for (const target of selected) {
      expect(target).not.toMatch(
        /\.t3([\\/]|$)|t3code|com\.t3tools|T3 Code|\.claude|\.codex|\.gemini|projects|worktrees/u,
      );
    }
    expect(plan.refusals).toEqual([]);
    if (!win && !mac) {
      expect(plan.actions).toContainEqual({ kind: "remove-app-manually", target: "" });
    }
  });

  it("keeps data unless asked, and adds the dev profile only when asked", () => {
    const fake = makeHome();
    const appOnly = targets(planUninstall(input(fake, { removeData: false })));
    expect(appOnly).not.toContain(fake.dataDir);
    expect(appOnly).not.toContain(fake.profile);
    expect(appOnly).toContain(fake.cmdeckLauncher);
    expect(targets(planUninstall(input(fake)))).not.toContain(fake.devProfile);
    expect(targets(planUninstall(input(fake, { includeDevProfile: true })))).toContain(
      fake.devProfile,
    );
  });

  it("removing every planned path leaves official T3 Code, providers and projects intact", () => {
    const fake = makeHome();
    // A worktree link inside the data folder must not be followed.
    const outside = NodePath.join(fake.root, "worktrees", "thread-1");
    link(outside, NodePath.join(fake.dataDir, "worktrees", "thread-1"), "junction");
    const plan = input(fake);
    for (const action of planUninstall(plan).actions) {
      if (action.kind === "remove-launcher" || action.kind === "remove-data") {
        removePlannedPath(plan, action);
      }
    }
    expect(NodeFS.existsSync(fake.dataDir)).toBe(false);
    expect(NodeFS.existsSync(fake.profile)).toBe(false);
    for (const target of fake.foreign) expect(NodeFS.existsSync(target)).toBe(true);
  });

  it.each([
    ["the official home", (fake: ReturnType<typeof makeHome>) => fake.j(".t3")],
    ["the home folder", (fake: ReturnType<typeof makeHome>) => fake.home],
    ["a filesystem root", (fake: ReturnType<typeof makeHome>) => NodePath.parse(fake.home).root],
    [
      "a folder outside home",
      (fake: ReturnType<typeof makeHome>) => NodePath.join(fake.root, "cmdeck"),
    ],
    ["a folder not named like CMDeck's", (fake: ReturnType<typeof makeHome>) => fake.j("projects")],
    ["a provider's config", (fake: ReturnType<typeof makeHome>) => fake.j(".claude")],
    [
      "a folder inside the official home",
      (fake: ReturnType<typeof makeHome>) => fake.j(".t3", "cmdeck"),
    ],
  ])("refuses to remove a data folder that is %s", (_name, dataDirOf) => {
    const fake = makeHome();
    const dataDir = dataDirOf(fake);
    if (!NodeFS.existsSync(dataDir)) NodeFS.mkdirSync(dataDir, { recursive: true });
    const plan = planUninstall(
      input(fake, { dataDir, env: { ...fake.env, CMDECK_HOME: dataDir } }),
    );
    expect(targets(plan)).not.toContain(dataDir);
    expect(
      plan.actions.filter((action) => action.kind === "remove-data").map((a) => a.target),
    ).toEqual([fake.profile]);
    expect(
      plan.refusals.some((refusal) => refusal.startsWith(`Kept ${NodePath.resolve(dataDir)}`)),
    ).toBe(true);
  });

  it("refuses a data folder that only T3CODE_HOME names", () => {
    const fake = makeHome();
    const dataDir = fake.j("cmdeck-shared");
    NodeFS.mkdirSync(dataDir);
    const plan = planUninstall(
      input(fake, { dataDir, env: { ...fake.env, T3CODE_HOME: dataDir } }),
    );
    expect(targets(plan)).not.toContain(dataDir);
    expect(plan.refusals.join("\n")).toContain("T3CODE_HOME");
  });

  it("ignores T3CODE_HOME naming the official home and never selects it", () => {
    const fake = makeHome();
    const plan = planUninstall(input(fake, { env: { ...fake.env, T3CODE_HOME: fake.j(".t3") } }));
    expect(targets(plan)).toContain(fake.dataDir);
    for (const target of targets(plan)) expect(target).not.toContain(`${NodePath.sep}.t3`);
  });

  it("refuses a data folder that links into the official home", () => {
    const fake = makeHome();
    NodeFS.rmSync(fake.dataDir, { recursive: true });
    if (!link(fake.j(".t3"), fake.dataDir, "junction")) return;
    const plan = planUninstall(input(fake));
    expect(targets(plan)).not.toContain(fake.dataDir);
    expect(plan.refusals.join("\n")).toContain(".t3");
  });

  it("skips marked launchers that link outside CMDeck's bin folder", () => {
    const fake = makeHome();
    const elsewhere = launcher(fake.j("elsewhere"), CLI_SHIM_MARKER);
    const at = fake.j(".local", "bin", win ? "cmdeck.cmd" : "cmdeck");
    if (!link(elsewhere, at)) return;
    expect(targets(planUninstall(input(fake)))).not.toContain(at);
  });

  it("refuses to act on a launcher whose marker changed after planning", () => {
    const fake = makeHome();
    const plan = input(fake);
    const action = planUninstall(plan).actions.find(
      (entry) => entry.target === fake.cmdeckLauncher,
    )!;
    NodeFS.writeFileSync(fake.cmdeckLauncher, "#!/bin/sh\necho mine\n");
    expect(() => removePlannedPath(plan, action)).toThrow(UninstallTargetChangedError);
    expect(NodeFS.existsSync(fake.cmdeckLauncher)).toBe(true);
    expect(() => assertStillPlanned(plan, action)).toThrow();
  });
});

function launcher(dir: string, marker: string) {
  return write(NodePath.join(dir, win ? "cmdeck.cmd" : "cmdeck"), `# ${marker}\n`);
}
