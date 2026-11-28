// Runs real containers. Gated on CMDECK_SANDBOX_LIVE=1, which only the "Container sandbox
// (Docker)" job in .github/workflows/fork-ci.yml sets, after pulling the image below.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AgentScope } from "@t3tools/shared/AgentScope";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { ContainerSandbox, ownerLabel } from "./ContainerSandbox.ts";
import { layerSandbox, makeHost, makeWorkspace, THREAD } from "./sandbox.testkit.ts";

const IMAGE = "alpine:3.20";
const live = process.env.CMDECK_SANDBOX_LIVE === "1";

const probeScript = (canary: string, workspace: string) =>
  [
    `cat ${canary} >/dev/null 2>&1 && echo canary=read || echo canary=blocked`,
    `cat ${workspace}/inside.txt >/dev/null 2>&1 && echo worktree=read || echo worktree=blocked`,
    `echo x >> ${workspace}/.git/config 2>/dev/null && echo gitconfig=written || echo gitconfig=blocked`,
    "wget -q -T 3 -O /dev/null http://1.1.1.1 2>/dev/null && echo network=open || echo network=blocked",
  ].join("; ");

describe.runIf(live)("container sandbox on a real Docker engine", () => {
  it.live(
    "blocks paths outside the worktree, writes to .git/config and the network",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        yield* fileSystem.writeFileString(path.join(workspace, "inside.txt"), "ok");
        const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-canary-" });
        const canary = path.join(outside, "canary.txt");
        yield* fileSystem.writeFileString(canary, "secret");
        const gitConfig = path.join(workspace, ".git", "config");
        const gitConfigBefore = yield* fileSystem.readFileString(gitConfig);

        const output = yield* Effect.gen(function* () {
          yield* (yield* ContainerSandbox).configure(
            { thread: { threadId: THREAD, mode: "on" } },
            "user",
          );
          const launch = yield* (yield* AgentScope).wrap({
            command: "sh",
            args: ["-c", probeScript(canary, workspace)],
            name: "agent",
            threadId: THREAD,
            env: process.env,
          });
          const runner = yield* ProcessRunner.ProcessRunner;
          return yield* runner.run({
            command: launch.command,
            args: launch.args,
            timeout: "60 seconds",
          });
        }).pipe(
          Effect.provide(
            layerSandbox({ workspace, host, realHost: true, recipe: { image: IMAGE } }),
          ),
        );

        expect(output.stdout.trim().split("\n")).toEqual([
          "canary=blocked",
          "worktree=read",
          "gitconfig=blocked",
          "network=blocked",
        ]);
        expect(yield* fileSystem.readFileString(gitConfig)).toBe(gitConfigBefore);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );

  it.live(
    "reaps this server's containers left by an earlier start",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-reap-" });
        const name = `cmdeck-agent-orphan-${process.pid}`;
        const docker = (args: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const runner = yield* ProcessRunner.ProcessRunner;
            return yield* runner.run({ command: "docker", args, timeout: "60 seconds" });
          });
        // An orphan from a crashed server: this server's owner label, an earlier boot.
        yield* Effect.gen(function* () {
          const { stateDir } = yield* ServerConfig.ServerConfig;
          yield* docker([
            "run",
            "-d",
            "--name",
            name,
            "--label",
            `cmdeck.owner=${ownerLabel(stateDir)}`,
            "--label",
            "cmdeck.boot=earlier",
            "--label",
            `cmdeck.thread=${THREAD}`,
            IMAGE,
            "sleep",
            "300",
          ]);
        }).pipe(Effect.provide(layerSandbox({ workspace, host, realHost: true, baseDir })));

        // The next start, with a thread in a container, reaps it in the background.
        const remaining = yield* docker(["ps", "-aq", "--filter", `name=${name}`]).pipe(
          Effect.map((result) => result.stdout.trim()),
          // The reap runs in the background at start-up; ask Docker until it has finished.
          Effect.repeat({ until: (ids) => ids === "", times: 200 }),
          Effect.provide(
            layerSandbox({
              workspace,
              host,
              realHost: true,
              baseDir,
              recipe: { image: IMAGE },
              sandboxedBefore: [THREAD],
            }),
          ),
        );
        expect(remaining).toBe("");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );
});
