import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, type SandboxRecipe } from "@t3tools/contracts";
import { AgentScope, type AgentScopeShape } from "@t3tools/shared/AgentScope";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as SqlClient from "effect/sql/SqlClient";

import * as AuditLog from "../audit/AuditLog.ts";
import { ContainerSandbox, recipeRefusal, runtimeStatuses } from "./ContainerSandbox.ts";
import { sandboxLaunchGate } from "./launchGate.ts";
import {
  type Host,
  layerSandbox,
  makeHost,
  makeWorkspace,
  PROJECT,
  THREAD,
} from "./sandbox.testkit.ts";

const valuesOf = (args: ReadonlyArray<string>, flag: string) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []));

const withSandbox = <A, E>(
  options: Omit<Parameters<typeof layerSandbox>[0], "workspace" | "host">,
  body: (context: {
    readonly host: Host;
    readonly workspace: string;
  }) => Effect.Effect<A, E, ContainerSandbox | SqlClient.SqlClient | AuditLog.AuditLog>,
) =>
  Effect.gen(function* () {
    const host = yield* makeHost;
    const workspace = yield* makeWorkspace;
    return yield* body({ host, workspace }).pipe(
      Effect.provide(layerSandbox({ ...options, workspace, host })),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const wrapAs = (name: string, env: NodeJS.ProcessEnv, threadId?: string) =>
  Effect.gen(function* () {
    const scope = yield* AgentScope;
    return yield* scope.wrap({
      command: "/usr/local/bin/claude",
      args: ["--print"],
      name,
      threadId,
      env,
    });
  });

describe("ContainerSandbox", () => {
  it.effect("leaves every thread on the host and spawns nothing until a thread opts in", () =>
    withSandbox({}, ({ host }) =>
      Effect.gen(function* () {
        const launch = yield* wrapAs("claude", {}, THREAD);
        expect(launch.command).toBe("/usr/local/bin/claude");
        expect(host.innerWraps).toEqual(["claude"]);
        expect(yield* (yield* ContainerSandbox).launchRefusal(THREAD, "codex")).toBeNull();
        expect(host.calls).toEqual([]);
      }),
    ),
  );

  it.effect("runs a sandboxed thread's provider and terminals in labelled containers", () =>
    withSandbox({}, ({ host, workspace }) =>
      Effect.gen(function* () {
        const sandbox = yield* ContainerSandbox;
        yield* sandbox.configure({ project: { projectId: PROJECT, mode: "on" } }, "user");
        const env = {
          ANTHROPIC_API_KEY: "sk-test",
          AWS_SECRET_ACCESS_KEY: "never",
          T3CODE_THREAD_ID: THREAD,
        };

        const agent = yield* wrapAs("claude", env, THREAD);
        expect(agent.command).toBe("docker");
        expect(agent.unit).toMatch(/^cmdeck-claude-/);
        expect(agent.args.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
        expect(valuesOf(agent.args, "--label")).toContain(`cmdeck.thread=${THREAD}`);
        expect(valuesOf(agent.args, "--network")).toEqual(["none"]);
        expect(valuesOf(agent.args, "-w")).toEqual([workspace]);
        expect(valuesOf(agent.args, "-e")).toEqual(["ANTHROPIC_API_KEY", "T3CODE_THREAD_ID"]);
        const mounts = valuesOf(agent.args, "--mount");
        expect(mounts[0]).toBe(`type=bind,source=${workspace},target=${workspace}`);
        expect(mounts.filter((mount) => mount.endsWith(",readonly"))).toHaveLength(5);
        expect(agent.args.slice(-3)).toEqual(["acme/agent:1", "claude", "--print"]);

        // Terminals carry the thread only in their environment.
        const terminal = yield* wrapAs("terminal", { T3CODE_THREAD_ID: THREAD });
        expect(terminal.args.slice(0, 4)).toEqual(["run", "--rm", "-i", "-t"]);
        expect(terminal.args.slice(-3, -1)).toEqual(["/bin/sh", "-c"]);
        expect(host.innerWraps).toEqual([]);

        // Codex's shared app-server serves other threads, so it is never put in one's container.
        const shared = yield* (yield* AgentScope).wrap({
          command: "codex",
          args: [],
          name: "codex",
          threadId: THREAD,
          shared: true,
        });
        expect(shared.command).toBe("codex");
      }),
    ),
  );

  it.effect("a thread's own choice overrides its project, and opting out is audited", () =>
    withSandbox({}, () =>
      Effect.gen(function* () {
        const sandbox = yield* ContainerSandbox;
        yield* sandbox.configure({ project: { projectId: PROJECT, mode: "on" } }, "user");
        const out = yield* sandbox.configure({ thread: { threadId: THREAD, mode: "off" } }, "user");
        expect(out.thread).toEqual({ threadId: THREAD, mode: "off", sandboxed: false });
        expect((yield* wrapAs("claude", {}, THREAD)).command).toBe("/usr/local/bin/claude");

        const cleared = yield* sandbox.configure(
          { thread: { threadId: THREAD, mode: null } },
          "user",
        );
        expect(cleared.thread?.sandboxed).toBe(true);
        yield* sandbox.configure({ project: { projectId: PROJECT, mode: "off" } }, "user");
        yield* sandbox.configure({ recipe: (yield* sandbox.status({})).recipe }, "user");
        yield* sandbox.configure(
          { recipe: { ...(yield* sandbox.status({})).recipe, network: "bridge" } },
          "user",
        );

        const entries = (yield* (yield* AuditLog.AuditLog).list({})).entries;
        expect(entries.map((entry) => [entry.kind, entry.subject]).toReversed()).toEqual([
          ["sandbox.opted_out", THREAD],
          ["sandbox.opted_out", PROJECT],
          ["sandbox.network_opened", "bridge"],
        ]);
      }),
    ),
  );

  it.effect("refuses a provider session that could not run in the container", () =>
    withSandbox({ docker: false }, () =>
      Effect.gen(function* () {
        const sandbox = yield* ContainerSandbox;
        yield* sandbox.configure({ thread: { threadId: THREAD, mode: "on" } }, "user");
        const open = (driver: string) =>
          sandboxLaunchGate(
            {
              threadId: THREAD,
              providerSessionId: ProviderSessionId.make("session-1"),
              modelSelection: { instanceId: ProviderInstanceId.make(driver) },
            },
            { get: () => Effect.succeed({ driver }) },
          ).pipe(Effect.flip);
        expect((yield* open("codex")).cause).toMatch(/codex cannot start inside one/);
        expect((yield* open("claudeAgent")).cause).toBe("Docker is not installed or not on PATH.");
        // A fail-closed wrap: the launch dies rather than start on the host.
        const exit = yield* Effect.exit(wrapAs("claude", {}, THREAD));
        expect(exit._tag).toBe("Failure");
      }),
    ),
  );

  it.effect("refuses a launch whose environment points Docker at another engine", () =>
    withSandbox({}, () =>
      Effect.gen(function* () {
        yield* (yield* ContainerSandbox).configure(
          { thread: { threadId: THREAD, mode: "on" } },
          "user",
        );
        const exit = yield* Effect.exit(
          wrapAs("claude", { DOCKER_HOST: "ssh://user@build-host" }, THREAD),
        );
        expect(exit._tag).toBe("Failure");
      }),
    ),
  );

  it.effect("kill and stop act on the thread's agent container", () =>
    withSandbox({}, ({ host }) =>
      Effect.gen(function* () {
        yield* (yield* ContainerSandbox).configure(
          { thread: { threadId: THREAD, mode: "on" } },
          "user",
        );
        const agent = yield* wrapAs("claude", {}, THREAD);
        const scope = yield* AgentScope;
        expect(yield* scope.kill(THREAD)).toBe(true);
        expect(host.calls).toContainEqual(["docker", "kill", agent.unit]);
        yield* scope.stop(agent.unit ?? "");
        expect(yield* Deferred.await(host.removed)).toEqual([agent.unit]);
      }),
    ),
  );
});

describe("git layout", () => {
  const launchIn = (options: { readonly projectRoot: string; readonly workspace: string }) =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      return yield* Effect.gen(function* () {
        yield* (yield* ContainerSandbox).configure(
          { thread: { threadId: THREAD, mode: "on" } },
          "user",
        );
        return yield* Effect.exit(wrapAs("claude", {}, THREAD));
      }).pipe(Effect.provide(layerSandbox({ ...options, host })));
    });

  /** A repository at `root` with a linked worktree at `worktree`, as `git worktree add` leaves it. */
  const linkedWorktree = Effect.fn(function* (root: string, worktree: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const admin = path.join(root, ".git", "worktrees", "wt");
    yield* fileSystem.makeDirectory(path.join(root, ".git", "objects"), { recursive: true });
    yield* fileSystem.writeFileString(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    yield* fileSystem.writeFileString(path.join(root, ".git", "config"), "[core]\n");
    yield* fileSystem.makeDirectory(admin, { recursive: true });
    yield* fileSystem.writeFileString(path.join(admin, "commondir"), "../..\n");
    yield* fileSystem.writeFileString(
      path.join(admin, "gitdir"),
      `${path.join(worktree, ".git")}\n`,
    );
    yield* fileSystem.writeFileString(path.join(worktree, ".git"), `gitdir: ${admin}\n`);
  });

  it.effect("mounts a linked worktree's own repository", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-root-" });
      const worktree = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-wt-" });
      yield* linkedWorktree(root, worktree);
      const exit = yield* launchIn({ projectRoot: root, workspace: worktree });
      expect(exit._tag).toBe("Success");
      if (exit._tag !== "Success") return;
      expect(valuesOf(exit.value.args, "--mount")).toContain(
        `type=bind,source=${path.join(root, ".git")},target=${path.join(root, ".git")}`,
      );
      const mounts = valuesOf(exit.value.args, "--mount");
      const at = (host: string, readOnly: boolean) =>
        `type=bind,source=${host},target=${host}${readOnly ? ",readonly" : ""}`;
      expect(mounts).toContain(at(path.join(root, ".git", "worktrees"), true));
      expect(mounts).toContain(at(path.join(root, ".git", "modules"), true));
      expect(mounts).toContain(at(path.join(root, ".git", "worktrees", "wt"), false));
      // Parents mount before children, so the read-only pointers sit on top of the admin dir.
      expect(mounts.indexOf(at(path.join(root, ".git", "worktrees", "wt"), false))).toBeLessThan(
        mounts.indexOf(at(path.join(root, ".git", "worktrees", "wt", "gitdir"), true)),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a .git file that points anywhere but the project's repository", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-root-" });
      const worktree = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-wt-" });
      const victim = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-home-" });
      yield* linkedWorktree(root, worktree);
      // What code in a container could write into its worktree before the next start.
      yield* fileSystem.writeFileString(path.join(worktree, ".git"), `gitdir: ${victim}\n`);
      const exit = yield* launchIn({ projectRoot: root, workspace: worktree });
      expect(exit._tag).toBe("Failure");
      expect(yield* fileSystem.exists(path.join(victim, "hooks"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses a main checkout whose .git directory was replaced by a file", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-root-" });
      const victim = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-home-" });
      yield* fileSystem.writeFileString(path.join(root, ".git"), `gitdir: ${victim}\n`);
      const exit = yield* launchIn({ projectRoot: root, workspace: root });
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("layer order", () => {
  it.effect("layers above it see the wrapper, not the AgentScope provided beneath it", () =>
    Effect.gen(function* () {
      const host = yield* makeHost;
      const workspace = yield* makeWorkspace;
      let seenAbove: string | undefined;
      const above = Layer.effectDiscard(
        Effect.gen(function* () {
          const sandbox = yield* ContainerSandbox;
          yield* sandbox.configure({ thread: { threadId: THREAD, mode: "on" } }, "user");
          seenAbove = (yield* wrapAs("claude", {}, THREAD)).command;
        }),
      );
      const beneath: AgentScopeShape = {
        ...AgentScope.defaultValue(),
        wrap: () => Effect.succeed({ command: "systemd-run", args: [] }),
      };
      // As in server.ts: the sandbox layer, then the platform AgentScope below it.
      yield* Layer.build(
        above.pipe(
          Layer.provideMerge(layerSandbox({ workspace, host })),
          Layer.provideMerge(Layer.succeed(AgentScope, beneath)),
        ),
      );
      expect(seenAbove).toBe("docker");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("start-up reaper", () => {
  it.effect("removes this server's containers from an earlier run, and only those", () =>
    withSandbox(
      { listed: "cmdeck-claude-old\tthread-1\told-boot\n", sandboxedBefore: [THREAD] },
      ({ host }) =>
        Effect.gen(function* () {
          expect(yield* Deferred.await(host.removed)).toEqual(["cmdeck-claude-old"]);
          expect(host.calls).toContainEqual(expect.arrayContaining(["ps", "-a"]));
        }),
    ),
  );
});

describe("disabled with a reason", () => {
  const recipe = (overrides: Partial<SandboxRecipe> = {}): SandboxRecipe => ({
    runtime: "docker",
    ociRuntime: null,
    image: "acme/agent:1",
    network: "none",
    cpus: null,
    memory: null,
    mounts: [],
    env: [],
    ...overrides,
  });
  const probed = {
    docker: { reason: null, ociRuntimes: ["runc"] },
    apple: { reason: null },
  };

  it.each([
    [recipe({ image: "" }), probed, "Choose a container image in Settings first."],
    [recipe({ ociRuntime: "runsc" }), probed, "Docker does not list the runsc runtime."],
    [
      recipe(),
      { ...probed, docker: { reason: "Docker is not installed or not on PATH.", ociRuntimes: [] } },
      "Docker is not installed or not on PATH.",
    ],
    [
      recipe({ runtime: "apple" }),
      probed,
      "Apple container cannot turn networking off. Choose a named network to use it.",
    ],
    [recipe({ runtime: "apple", network: "agents" }), probed, null],
    [
      recipe({ ociRuntime: "runsc" }),
      { ...probed, docker: { reason: null, ociRuntimes: ["runc", "runsc"] } },
      null,
    ],
  ] as const)("%#", (current, host, reason) => {
    expect(recipeRefusal(runtimeStatuses(host, current), current)).toBe(reason);
  });

  it.effect("a remote DOCKER_HOST disables Docker instead of using it", () =>
    withSandbox({ env: { DOCKER_HOST: "ssh://user@build-host" } }, ({ host }) =>
      Effect.gen(function* () {
        const status = yield* (yield* ContainerSandbox).status({});
        expect(status.ready).toBe(false);
        expect(status.runtimes[0]?.reason).toMatch(/only uses the local Docker engine/);
        expect(host.calls.filter((call) => call[0] === "docker")).toEqual([]);
      }),
    ),
  );
});
