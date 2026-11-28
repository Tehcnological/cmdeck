// @effect-diagnostics nodeBuiltinImport:off -- the agent's commit is made with the git CLI.
import * as NodeChildProcess from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AgentScope } from "@t3tools/shared/AgentScope";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ContainerSandbox } from "./ContainerSandbox.ts";
import {
  gitIn,
  layerSandbox,
  makeHost,
  makeWorkspace,
  privateDirOf,
  THREAD,
} from "./sandbox.testkit.ts";

const valuesOf = (args: ReadonlyArray<string>, flag: string) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []));

const launchAgent = Effect.gen(function* () {
  yield* (yield* ContainerSandbox).configure({ thread: { threadId: THREAD, mode: "on" } }, "user");
  return yield* (yield* AgentScope).wrap({
    command: "claude",
    args: [],
    name: "claude",
    threadId: THREAD,
    env: {},
  });
});

/** What the agent does inside: commit a change in its private git dir. */
const agentCommits = (workspace: string, privateDir: string, file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fileSystem.writeFileString(path.join(workspace, file), "from the agent\n");
    const env = {
      ...process.env,
      GIT_DIR: privateDir,
      GIT_WORK_TREE: workspace,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(workspace, ".git", "objects"),
    };
    const run = (args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync(
        "git",
        ["-c", "user.name=agent", "-c", "user.email=a@example.com", ...args],
        { cwd: workspace, env, encoding: "utf8" },
      ).trim();
    run(["add", file]);
    run(["commit", "-q", "-m", `agent ${file}`]);
    return run(["rev-parse", "HEAD"]);
  });

describe("private git dir", () => {
  it.effect("gives the container the worktree and its own git dir, never the host's .git", () =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const workspace = yield* makeWorkspace;
      const path = yield* Path.Path;
      const agent = yield* launchAgent.pipe(Effect.provide(layerSandbox({ workspace, host })));
      const mounts = valuesOf(agent.args, "--mount");
      const dotGit = path.join(workspace, ".git");
      expect(mounts).toContain(`type=bind,source=${workspace},target=${workspace}`);
      expect(mounts.some((mount) => mount.endsWith("target=/cmdeck/git"))).toBe(true);
      expect(mounts).toContain(
        `type=bind,source=${path.join(dotGit, "objects")},target=/cmdeck/host-objects,readonly`,
      );
      // The host's .git is covered, read-only, by an empty directory.
      expect(mounts.find((mount) => mount.includes(`target=${dotGit},`))).toMatch(/,readonly$/);
      expect(mounts.some((mount) => mount.includes(`source=${dotGit},`))).toBe(false);
      expect(valuesOf(agent.args, "-e")).toContain("GIT_DIR=/cmdeck/git");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each([
    ["a folder that is not a repository", "plain"],
    ["a repository with submodules", "submodules"],
    ["a case-insensitive volume", "case"],
  ] as const)("refuses %s", ([, kind]) =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace =
        kind === "plain"
          ? yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-plain-" })
          : yield* makeWorkspace;
      if (kind === "submodules") {
        yield* fileSystem.writeFileString(path.join(workspace, ".gitmodules"), "");
      }
      if (kind === "case") {
        // Already there on a case-insensitive volume; made on a case-sensitive one.
        yield* fileSystem.makeDirectory(path.join(workspace, ".GIT")).pipe(Effect.ignore);
      }
      const exit = yield* Effect.exit(launchAgent).pipe(
        Effect.provide(layerSandbox({ workspace, host, realCaseCheck: kind === "case" })),
      );
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("brings the agent's commit onto the thread's branch when its container stops", () =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const workspace = yield* makeWorkspace;
      yield* Effect.gen(function* () {
        const agent = yield* launchAgent;
        const commit = yield* agentCommits(workspace, yield* privateDirOf, "agent.txt");
        yield* (yield* AgentScope).stop(agent.unit ?? "");
        expect(yield* gitIn(workspace, ["rev-parse", "HEAD"])).toBe(commit);
        expect(yield* gitIn(workspace, ["status", "--porcelain"])).toBe("");
      }).pipe(Effect.provide(layerSandbox({ workspace, host })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never reads what the container wrote in its git dir as git config", () =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const workspace = yield* makeWorkspace;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* Effect.gen(function* () {
        const agent = yield* launchAgent;
        const privateDir = yield* privateDirOf;
        const commit = yield* agentCommits(workspace, privateDir, "agent.txt");
        // Host git would fail on this config, or follow commondir elsewhere, if it read either.
        yield* fileSystem.writeFileString(path.join(privateDir, "config"), "[core\nnot git config");
        yield* fileSystem.writeFileString(path.join(privateDir, "commondir"), "../../elsewhere\n");
        yield* (yield* AgentScope).stop(agent.unit ?? "");
        expect(yield* gitIn(workspace, ["rev-parse", "HEAD"])).toBe(commit);
        // The next launch rebuilds the git dir before host git touches it.
        yield* launchAgent;
        expect(yield* fileSystem.exists(path.join(privateDir, "commondir"))).toBe(false);
      }).pipe(Effect.provide(layerSandbox({ workspace, host })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the agent's commits aside when the branch moved on the host", () =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const workspace = yield* makeWorkspace;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* Effect.gen(function* () {
        const agent = yield* launchAgent;
        const commit = yield* agentCommits(workspace, yield* privateDirOf, "agent.txt");
        yield* fileSystem.writeFileString(path.join(workspace, "host.txt"), "host\n");
        yield* gitIn(workspace, ["add", "host.txt"]);
        yield* gitIn(workspace, ["commit", "-q", "-m", "host"]);
        const hostHead = yield* gitIn(workspace, ["rev-parse", "HEAD"]);
        yield* (yield* AgentScope).stop(agent.unit ?? "");
        expect(yield* gitIn(workspace, ["rev-parse", "HEAD"])).toBe(hostHead);
        expect(yield* gitIn(workspace, ["rev-parse", `refs/cmdeck/sandbox/${THREAD}`])).toBe(
          commit,
        );
      }).pipe(Effect.provide(layerSandbox({ workspace, host })));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
