// @effect-diagnostics nodeBuiltinImport:off -- the repository is made and read with the git CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { serverGitConfigEnv } from "../../vcs/VcsProcess.ts";

const dirs: Array<string> = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

// A container can write a nested repository into the worktree; host git must not run its config.
describe("host git", () => {
  it("never runs a repository's fsmonitor command", () => {
    const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cmdeck-fsmonitor-"));
    dirs.push(repo);
    const marker = NodePath.join(repo, "ran").replaceAll("\\", "/");
    const git = (args: ReadonlyArray<string>, env: NodeJS.ProcessEnv = process.env) =>
      NodeChildProcess.execFileSync("git", args, { cwd: repo, env, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "core.fsmonitor", `touch '${marker}'; false`]);
    git(["status", "--porcelain"], {
      ...process.env,
      ...serverGitConfigEnv(process.env, HostProcess.Platform.defaultValue()),
    });
    expect(NodeFS.existsSync(marker)).toBe(false);
  });
});
