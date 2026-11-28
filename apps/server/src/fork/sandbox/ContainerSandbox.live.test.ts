// Runs real containers. Gated on CMDECK_SANDBOX_LIVE=1, which only the "Container sandbox
// (Docker)" job in .github/workflows/fork-ci.yml sets, after pulling the image below.
// On Windows, point TEMP/TMP at a case-sensitive folder: the test workspaces are made there.
// CMDECK_SANDBOX_LIVE_KIND=apple uses Apple `container` (default docker); CMDECK_SANDBOX_LIVE_RUNTIME=runsc picks an OCI runtime.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { SandboxRecipe } from "@t3tools/contracts";
import { AgentScope } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { ContainerSandbox, ownerLabel } from "./ContainerSandbox.ts";
import {
  containerPathFor,
  LABEL_BOOT,
  LABEL_OWNER,
  LABEL_THREAD,
  listArgs,
  parseList,
  RUNTIME_TRAITS,
  runArgs,
} from "./argv.ts";
import {
  gitIn,
  type Host,
  layerSandbox,
  makeHost,
  makeWorkspace,
  THREAD,
} from "./sandbox.testkit.ts";

// Ships git and a shell with no entrypoint (alpine/git's entrypoint is git, so `sh -c` cannot run).
const IMAGE =
  "buildpack-deps:26.04-scm@sha256:d4ac7970aaf4e0865b0493cfdc569e30888e51a59b4e402cf30f927af26f332b";
const KIND = process.env.CMDECK_SANDBOX_LIVE_KIND === "apple" ? "apple" : "docker";
const TRAITS = RUNTIME_TRAITS[KIND];
// Apple `container` has no network-off mode, so the product refuses `none` there: use its own network.
const RECIPE = {
  image: IMAGE,
  runtime: KIND,
  network: TRAITS.networkNone ? "none" : "default",
  ociRuntime: process.env.CMDECK_SANDBOX_LIVE_RUNTIME || null,
} satisfies Partial<SandboxRecipe>;
const live = process.env.CMDECK_SANDBOX_LIVE === "1";

const probeScript = (canary: string, workspace: string) =>
  [
    `cat ${canary} >/dev/null 2>&1 && echo canary=read || echo canary=blocked`,
    `cat ${workspace}/inside.txt >/dev/null 2>&1 && echo worktree=read || echo worktree=blocked`,
    `echo x >> ${workspace}/.git/config 2>/dev/null && echo gitconfig=written || echo gitconfig=blocked`,
    "wget -q -T 3 -O /dev/null http://1.1.1.1 2>/dev/null && echo network=open || echo network=blocked",
  ].join("; ");

const SIDE_REF = `refs/cmdeck/sandbox/${THREAD}`;

/** What a real agent does: plain git in the worktree, through the private git dir CMDeck gives it. */
const commitScript = [
  "export GIT_AUTHOR_NAME=agent GIT_AUTHOR_EMAIL=agent@example.com",
  "export GIT_COMMITTER_NAME=agent GIT_COMMITTER_EMAIL=agent@example.com",
  "echo agent > README.md",
  "git add README.md",
  "git commit -q -m agent",
  "git rev-parse HEAD",
].join(" && ");

const layerLive = (workspace: string, host: Host) =>
  layerSandbox({ workspace, host, realHost: true, realCaseCheck: true, recipe: RECIPE });

/** Runs `script` as the thread's agent in a container, then stops it, which imports its commits. */
const runAgent = (script: string, whileRunning: Effect.Effect<unknown> = Effect.void) =>
  Effect.gen(function* () {
    yield* (yield* ContainerSandbox).configure(
      { thread: { threadId: THREAD, mode: "on" } },
      "user",
    );
    const scope = yield* AgentScope;
    const launch = yield* scope.wrap({
      command: "sh",
      args: ["-c", script],
      name: "agent",
      threadId: THREAD,
      env: process.env,
    });
    yield* whileRunning;
    const output = yield* (yield* ProcessRunner.ProcessRunner).run({
      command: launch.command,
      args: launch.args,
      timeout: "60 seconds",
    });
    expect(output.code, output.stderr).toBe(0);
    yield* scope.stop(launch.unit ?? "");
    return output.stdout.trim().split("\n").at(-1) ?? "";
  });

describe.runIf(live)("container sandbox on a real container engine", () => {
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
          // The worktree is mounted at its container path (/c/... on Windows).
          const platform = yield* HostProcess.Platform;
          const launch = yield* (yield* AgentScope).wrap({
            command: "sh",
            args: [
              "-c",
              probeScript(
                containerPathFor(canary, platform),
                containerPathFor(workspace, platform),
              ),
            ],
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
        }).pipe(Effect.provide(layerSandbox({ workspace, host, realHost: true, recipe: RECIPE })));

        expect(output.stdout.trim().split("\n")).toEqual([
          "canary=blocked",
          "worktree=read",
          "gitconfig=blocked",
          TRAITS.networkNone ? "network=blocked" : expect.stringMatching(/^network=/),
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
        const cli = (args: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const runner = yield* ProcessRunner.ProcessRunner;
            return yield* runner.run({ command: TRAITS.binary, args, timeout: "60 seconds" });
          });
        // An orphan from a crashed server: this server's owner label, an earlier boot.
        const owner = yield* Effect.gen(function* () {
          const { stateDir } = yield* ServerConfig.ServerConfig;
          const owner = ownerLabel(stateDir);
          const args = runArgs({
            runtime: KIND,
            name,
            image: IMAGE,
            labels: { [LABEL_OWNER]: owner, [LABEL_BOOT]: "earlier", [LABEL_THREAD]: THREAD },
            workdir: "/",
            mounts: [],
            envKeys: [],
            envValues: {},
            network: RECIPE.network,
            ociRuntime: null,
            cpus: null,
            memory: null,
            user: null,
            tty: false,
            command: "sleep",
            args: ["300"],
          });
          // Detached, so the orphan outlives this call as a crashed server's would.
          args.splice(args.indexOf("run") + 1, 0, "-d");
          yield* cli(args);
          return owner;
        }).pipe(Effect.provide(layerSandbox({ workspace, host, realHost: true, baseDir })));

        // The next start, with a thread in a container, reaps it in the background.
        const remaining = yield* cli(listArgs(KIND, owner)).pipe(
          Effect.map((result) =>
            parseList(KIND, result.stdout, owner).filter((listed) => listed.name === name),
          ),
          // The reap runs in the background at start-up; ask the runtime until it has finished.
          Effect.repeat({ until: (left) => left.length === 0, times: 200 }),
          Effect.provide(
            layerSandbox({
              workspace,
              host,
              realHost: true,
              baseDir,
              recipe: RECIPE,
              sandboxedBefore: [THREAD],
            }),
          ),
        );
        expect(remaining).toEqual([]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );

  it.live(
    "refuses no network only on a runtime that cannot turn it off",
    () =>
      Effect.gen(function* () {
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        const refusal = yield* Effect.gen(function* () {
          const sandbox = yield* ContainerSandbox;
          yield* sandbox.configure({ thread: { threadId: THREAD, mode: "on" } }, "user");
          return yield* sandbox.launchRefusal(THREAD, "claudeAgent");
        }).pipe(
          Effect.provide(
            layerSandbox({
              workspace,
              host,
              realHost: true,
              recipe: { ...RECIPE, network: "none" },
            }),
          ),
        );
        expect(refusal).toBe(
          TRAITS.networkNone
            ? null
            : "Apple container cannot turn networking off. Choose a named network to use it.",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );

  it.live(
    "fast-forwards the thread's branch to the agent's commit",
    () =>
      Effect.gen(function* () {
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        const commit = yield* runAgent(commitScript).pipe(
          Effect.provide(layerLive(workspace, host)),
        );
        expect(yield* gitIn(workspace, ["rev-parse", "main"])).toBe(commit);
        expect(yield* gitIn(workspace, ["rev-parse", SIDE_REF])).toBe(commit);
        expect(yield* gitIn(workspace, ["show", "main:README.md"])).toBe("agent");
        expect(yield* gitIn(workspace, ["status", "--porcelain"])).toBe("");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );

  it.live(
    "keeps the agent's commit on the side ref when the host branch moved",
    () =>
      Effect.gen(function* () {
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        const start = yield* gitIn(workspace, ["rev-parse", "main"]);
        const commit = yield* runAgent(
          commitScript,
          gitIn(workspace, ["commit", "-q", "--allow-empty", "-m", "host"]),
        ).pipe(Effect.provide(layerLive(workspace, host)));
        expect(yield* gitIn(workspace, ["log", "-1", "--format=%s", "main"])).toBe("host");
        expect(yield* gitIn(workspace, ["rev-parse", "main^"])).toBe(start);
        expect(yield* gitIn(workspace, ["rev-parse", SIDE_REF])).toBe(commit);
        expect(yield* gitIn(workspace, ["rev-parse", `${commit}^`])).toBe(start);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );

  it.live(
    "never runs an fsmonitor or hook the container configured",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const host = yield* makeHost;
        const workspace = yield* makeWorkspace;
        // Armed after the commit, so only a host git that picked them up would leave `bled`.
        const trap = [
          'mkdir -p .hooks "$GIT_DIR/hooks"',
          "printf '#!/bin/sh\\ntouch bled\\n' > .hooks/fsmonitor",
          "chmod +x .hooks/fsmonitor",
          "cp .hooks/fsmonitor .hooks/post-index-change",
          'cp .hooks/fsmonitor "$GIT_DIR/hooks/post-index-change"',
          'git config core.fsmonitor "$PWD/.hooks/fsmonitor"',
          'git config core.hooksPath "$PWD/.hooks"',
        ].join(" && ");
        const commit = yield* runAgent(`${commitScript} && ${trap}`).pipe(
          Effect.provide(layerLive(workspace, host)),
        );
        expect(yield* gitIn(workspace, ["rev-parse", "main"])).toBe(commit);
        const bled = path.join(workspace, "bled");
        yield* gitIn(workspace, ["status"]);
        expect(yield* fileSystem.exists(bled)).toBe(false);
        // The trap is live: host git told to use it does run it.
        yield* gitIn(workspace, ["-c", "core.fsmonitor=.hooks/fsmonitor", "status"]);
        expect(yield* fileSystem.exists(bled)).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    120_000,
  );
});
