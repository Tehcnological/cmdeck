// Cases ported from agent-of-empires@e5cf0b9f388de560e5716184f5507d744a517f27
// src/containers/runtime_base.rs (create_args_* tests) (MIT).
import { describe, expect, it } from "vite-plus/test";

import {
  appleContainerHostReason,
  containerCommand,
  containerPathFor,
  forwardedEnvKeys,
  gitProtectedPaths,
  isLocalDockerEndpoint,
  listArgs,
  mountArg,
  parseDockerRuntimes,
  parseList,
  removeArgs,
  type RunSpec,
  runArgs,
} from "./argv.ts";

const spec = (overrides: Partial<RunSpec> = {}): RunSpec => ({
  runtime: "docker",
  name: "cmdeck-claude-abc",
  image: "acme/agent:1",
  labels: { "cmdeck.thread": "thread-1", "cmdeck.owner": "own", "cmdeck.boot": "b1" },
  workdir: "/home/user/app",
  mounts: [
    { hostPath: "/home/user/app", containerPath: "/home/user/app", readOnly: false },
    {
      hostPath: "/home/user/app/.git/config",
      containerPath: "/home/user/app/.git/config",
      readOnly: true,
    },
  ],
  envKeys: ["ANTHROPIC_API_KEY"],
  network: "none",
  ociRuntime: null,
  cpus: null,
  memory: null,
  user: null,
  tty: false,
  command: "claude",
  args: ["--print"],
  ...overrides,
});

const valuesOf = (args: ReadonlyArray<string>, flag: string) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

describe("runArgs", () => {
  it.each([
    {
      runtime: "docker" as const,
      ociRuntime: null,
      mounts: [
        "type=bind,source=/home/user/app,target=/home/user/app",
        "type=bind,source=/home/user/app/.git/config,target=/home/user/app/.git/config,readonly",
      ],
      runtimeFlag: [],
    },
    {
      runtime: "docker" as const,
      ociRuntime: "runsc",
      mounts: [
        "type=bind,source=/home/user/app,target=/home/user/app",
        "type=bind,source=/home/user/app/.git/config,target=/home/user/app/.git/config,readonly",
      ],
      runtimeFlag: ["runsc"],
    },
    {
      // Apple has no read-only mounts and no OCI runtime choice.
      runtime: "apple" as const,
      ociRuntime: "runsc",
      mounts: [
        "type=bind,source=/home/user/app,target=/home/user/app",
        "type=bind,source=/home/user/app/.git/config,target=/home/user/app/.git/config",
      ],
      runtimeFlag: [],
    },
  ])("$runtime with oci runtime $ociRuntime", ({ runtime, ociRuntime, mounts, runtimeFlag }) => {
    const args = runArgs(spec({ runtime, ociRuntime }));
    expect(args.slice(0, 5)).toEqual(["run", "--rm", "-i", "--name", "cmdeck-claude-abc"]);
    expect(valuesOf(args, "--mount")).toEqual(mounts);
    expect(valuesOf(args, "--runtime")).toEqual(runtimeFlag);
    expect(valuesOf(args, "--label")).toEqual([
      "cmdeck.thread=thread-1",
      "cmdeck.owner=own",
      "cmdeck.boot=b1",
    ]);
    expect(valuesOf(args, "-w")).toEqual(["/home/user/app"]);
    expect(valuesOf(args, "--network")).toEqual(["none"]);
    expect(args.slice(-3)).toEqual(["acme/agent:1", "claude", "--print"]);
  });

  it("passes credentials by name only, so no value reaches argv", () => {
    const args = runArgs(spec({ envKeys: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] }));
    expect(valuesOf(args, "-e")).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(args).not.toContain("--env-file");
  });

  it("adds limits, user and a TTY only when asked", () => {
    const bare = runArgs(spec());
    for (const flag of ["--cpus", "-m", "--user", "-t"]) expect(bare).not.toContain(flag);
    const full = runArgs(spec({ cpus: "2", memory: "4g", user: "1000:1000", tty: true }));
    expect(valuesOf(full, "--cpus")).toEqual(["2"]);
    expect(valuesOf(full, "-m")).toEqual(["4g"]);
    expect(valuesOf(full, "--user")).toEqual(["1000:1000"]);
    expect(full.slice(0, 4)).toEqual(["run", "--rm", "-i", "-t"]);
  });

  it("keeps a named network", () => {
    expect(valuesOf(runArgs(spec({ network: "agents" })), "--network")).toEqual(["agents"]);
  });
});

describe("mountArg", () => {
  it("quotes CSV fields with commas or quotes, and maps Windows sources as given", () => {
    expect(mountArg({ hostPath: "/a,b", containerPath: '/c"d', readOnly: true }, true)).toBe(
      'type=bind,"source=/a,b","target=/c""d",readonly',
    );
    expect(
      mountArg(
        { hostPath: "C:\\Users\\me\\app", containerPath: "/c/Users/me/app", readOnly: false },
        false,
      ),
    ).toBe("type=bind,source=C:\\Users\\me\\app,target=/c/Users/me/app");
  });
});

describe("containerPathFor", () => {
  it.each([
    ["linux", "/home/user/app", "/home/user/app"],
    ["darwin", "/Users/me/app", "/Users/me/app"],
    ["win32", "C:\\Users\\me\\app", "/c/Users/me/app"],
    ["win32", "D:\\", "/d"],
    ["win32", "c:/work/app/", "/c/work/app"],
  ] as const)("%s %s", (platform, host, container) => {
    expect(containerPathFor(host, platform)).toBe(container);
  });
});

describe("gitProtectedPaths", () => {
  const join = (...parts: ReadonlyArray<string>) => parts.join("/");
  it("protects config, hooks and config.worktree of a main checkout", () => {
    expect(
      gitProtectedPaths({ commonDir: "/r/.git", adminDir: "/r/.git", dotGitFile: null }, join),
    ).toEqual([
      { path: "/r/.git/config", kind: "file", create: false },
      { path: "/r/.git/hooks", kind: "dir", create: true },
      { path: "/r/.git/config.worktree", kind: "file", create: true },
    ]);
  });

  it("also protects a linked worktree's pointers and its .git file", () => {
    const paths = gitProtectedPaths(
      { commonDir: "/r/.git", adminDir: "/r/.git/worktrees/wt", dotGitFile: "/wt/.git" },
      join,
    ).map((entry) => entry.path);
    expect(paths).toEqual([
      "/r/.git/config",
      "/r/.git/hooks",
      "/r/.git/config.worktree",
      "/r/.git/worktrees/wt/config.worktree",
      "/r/.git/worktrees/wt/commondir",
      "/r/.git/worktrees/wt/gitdir",
      "/wt/.git",
    ]);
  });
});

describe("forwardedEnvKeys", () => {
  it("passes provider credentials and the recipe's names, never the rest of the host", () => {
    const env = {
      ANTHROPIC_API_KEY: "a",
      CLAUDE_CODE_OAUTH_TOKEN: "b",
      T3CODE_THREAD_ID: "t",
      AWS_SECRET_ACCESS_KEY: "x",
      GH_TOKEN: "y",
      PATH: "/bin",
      TERM: "xterm",
      HTTPS_PROXY: "http://proxy",
      UNSET: undefined,
      "BAD-NAME": "z",
    };
    expect(forwardedEnvKeys(env, ["GH_TOKEN", " UNSET ", "BAD-NAME"])).toEqual([
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "GH_TOKEN",
      "T3CODE_THREAD_ID",
      "TERM",
    ]);
  });
});

describe("containerCommand", () => {
  it.each([
    ["claude", "/usr/local/bin/claude", ["-p"], "claude", ["-p"]],
    ["claude", "C:\\Tools\\claude.exe", [], "claude", []],
    ["claude", "claude", [], "claude", []],
  ] as const)("%s from %s", (name, command, args, expectedCommand, expectedArgs) => {
    expect(containerCommand(name, command, args)).toEqual({
      command: expectedCommand,
      args: expectedArgs,
    });
  });

  it("starts the image's login shell for a terminal, whatever the host shell is", () => {
    const { command, args } = containerCommand("terminal", "C:\\Windows\\pwsh.exe", ["-NoLogo"]);
    expect(command).toBe("/bin/sh");
    expect(args[0]).toBe("-c");
  });
});

describe("list, remove and parse", () => {
  it("filters Docker by owner label and reads names, threads and boots", () => {
    expect(listArgs("docker", "own")).toContain("label=cmdeck.owner=own");
    expect(
      parseList("docker", "cmdeck-a\tthread-1\tb1\ncmdeck-b\tthread-2\tb0\n\n", "own"),
    ).toEqual([
      { name: "cmdeck-a", threadId: "thread-1", boot: "b1" },
      { name: "cmdeck-b", threadId: "thread-2", boot: "b0" },
    ]);
  });

  it("filters Apple's JSON list by owner itself", () => {
    const listed = JSON.stringify([
      {
        configuration: {
          id: "cmdeck-a",
          labels: { "cmdeck.owner": "own", "cmdeck.thread": "t1", "cmdeck.boot": "b0" },
        },
      },
      { configuration: { id: "theirs", labels: { "cmdeck.owner": "other" } } },
      { configuration: { id: "unlabelled", labels: [] } },
      {},
    ]);
    expect(listArgs("apple", "own")).toEqual(["list", "--all", "--format", "json"]);
    expect(parseList("apple", listed, "own")).toEqual([
      { name: "cmdeck-a", threadId: "t1", boot: "b0" },
    ]);
    expect(parseList("apple", "not json", "own")).toEqual([]);
  });

  it("removes with each CLI's force flag", () => {
    expect(removeArgs("docker", ["a", "b"])).toEqual(["rm", "-f", "a", "b"]);
    expect(removeArgs("apple", ["a"])).toEqual(["delete", "--force", "a"]);
  });
});

describe("runtime probes", () => {
  it("accepts only a local Docker socket or pipe", () => {
    expect(isLocalDockerEndpoint("unix:///var/run/docker.sock")).toBe(true);
    expect(isLocalDockerEndpoint("npipe:////./pipe/docker_engine")).toBe(true);
    expect(isLocalDockerEndpoint("ssh://user@host")).toBe(false);
    expect(isLocalDockerEndpoint("")).toBe(false);
  });

  it("reads OCI runtimes from docker info", () => {
    expect(
      parseDockerRuntimes('{"runc":{"path":"runc"},"runsc":{"path":"/usr/bin/runsc"}}'),
    ).toEqual(["runc", "runsc"]);
    expect(parseDockerRuntimes("")).toEqual([]);
  });

  it.each([
    ["linux", "x64", "6.8.0", "Apple container runs only on macOS."],
    ["darwin", "x64", "25.0.0", "Apple container needs a Mac with Apple silicon."],
    ["darwin", "arm64", "24.6.0", "Apple container needs macOS 26 or later."],
    ["darwin", "arm64", "25.1.0", null],
  ] as const)("Apple container on %s %s %s", (platform, arch, release, reason) => {
    expect(appleContainerHostReason(platform, arch, release)).toBe(reason);
  });
});
