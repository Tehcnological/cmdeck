// @effect-diagnostics nodeBuiltinImport:off -- container names and the owner label hash with Node crypto.
// Fork-only. Runs a sandboxed thread's provider and terminals in containers (WI-2.18).
import * as NodeCrypto from "node:crypto";

import {
  type ProjectId,
  type SandboxConfigureInput,
  SandboxError,
  type SandboxMode,
  SandboxRecipe,
  type SandboxRuntimeKind,
  type SandboxRuntimeStatus,
  type SandboxStatus,
  type SandboxStatusInput,
  ThreadId,
} from "@t3tools/contracts";
import { AgentScope, type AgentScopeShape } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { AGENT_THREAD_ENV } from "../../preview/PortScanner.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import {
  appleContainerHostReason,
  type ContainerMount,
  containerCommand,
  containerPathFor,
  forwardedEnvKeys,
  type GitLayout,
  gitProtectedPaths,
  isLocalDockerEndpoint,
  LABEL_BOOT,
  LABEL_OWNER,
  LABEL_THREAD,
  listArgs,
  parseDockerRuntimes,
  parseList,
  removeArgs,
  RUNTIME_TRAITS,
  runArgs,
} from "./argv.ts";

/** Only Claude starts one CLI process per thread; Codex shares one app-server across threads. */
const CONTAINER_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent"]);

export class ContainerSandbox extends Context.Service<
  ContainerSandbox,
  {
    readonly status: (input: SandboxStatusInput) => Effect.Effect<SandboxStatus, SandboxError>;
    readonly configure: (
      input: SandboxConfigureInput,
      actor: string,
    ) => Effect.Effect<SandboxStatus, SandboxError>;
    readonly isSandboxed: (threadId: string) => Effect.Effect<boolean>;
    /** Why a provider session must not open for this thread, or null when it may. */
    readonly launchRefusal: (threadId: string, driver: string) => Effect.Effect<string | null>;
    readonly removeThread: (threadId: string) => Effect.Effect<void>;
    /** Runs `start` once the first container starts, or now if one has; nothing runs before. */
    readonly whenInUse: (start: Effect.Effect<void>) => Effect.Effect<void>;
  }
>()("t3/fork/sandbox/ContainerSandbox") {}

const NOT_CHECKED_REASON = "Not checked yet.";
const NOT_CHECKED: ProbedRuntimes = {
  docker: { reason: NOT_CHECKED_REASON, ociRuntimes: [] },
  apple: { reason: NOT_CHECKED_REASON },
};

interface ProbedRuntimes {
  readonly docker: { readonly reason: string | null; readonly ociRuntimes: ReadonlyArray<string> };
  readonly apple: { readonly reason: string | null };
}

/** The recipe's own reasons a runtime cannot be used, on top of what the host probe found. */
export function runtimeStatuses(
  probed: ProbedRuntimes,
  recipe: SandboxRecipe,
): Array<SandboxRuntimeStatus> {
  const dockerReason =
    probed.docker.reason ??
    (recipe.ociRuntime !== null && !probed.docker.ociRuntimes.includes(recipe.ociRuntime)
      ? `Docker does not list the ${recipe.ociRuntime} runtime.`
      : null);
  const appleReason =
    probed.apple.reason ??
    (recipe.network === "none"
      ? "Apple container cannot turn networking off. Choose a named network to use it."
      : null);
  return [
    {
      kind: "docker",
      available: dockerReason === null,
      reason: dockerReason,
      ociRuntimes: [...probed.docker.ociRuntimes],
      gitOverlayIsCopy: false,
    },
    {
      kind: "apple",
      available: appleReason === null,
      reason: appleReason,
      ociRuntimes: [],
      gitOverlayIsCopy: true,
    },
  ];
}

/** Null when the recipe can start containers; otherwise what to fix. */
export function recipeRefusal(
  statuses: ReadonlyArray<SandboxRuntimeStatus>,
  recipe: SandboxRecipe,
): string | null {
  if (recipe.image.trim() === "") return "Choose a container image in Settings first.";
  const runtime = statuses.find((status) => status.kind === recipe.runtime);
  return runtime === undefined || runtime.available
    ? null
    : (runtime.reason ?? "The container runtime is not available.");
}

/** Labels this server's containers, so another CMDeck's reaper on the same engine leaves them alone. */
export const ownerLabel = (stateDir: string) =>
  NodeCrypto.createHash("sha256").update(stateDir).digest("hex").slice(0, 12);

interface ModeRow {
  readonly kind: "project" | "thread";
  readonly target_id: string;
  readonly mode: SandboxMode;
}

const decodeRecipe = Schema.decodeEffect(Schema.fromJsonString(SandboxRecipe));
const encodeRecipe = Schema.encodeEffect(Schema.fromJsonString(SandboxRecipe));

const toError = (detail: string) => (cause: unknown) => new SandboxError({ detail, cause });

const make = Effect.gen(function* () {
  const inner = yield* AgentScope;
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const audit = yield* AuditLog.AuditLog;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const hostEnvironment = yield* HostProcess.Environment;
  const architecture = yield* HostProcess.Architecture;
  const kernelRelease = yield* HostProcess.KernelRelease;
  const userId = yield* HostProcess.UserId;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const layerScope = yield* Effect.scope;

  const owner = ownerLabel(stateDir);
  // Containers from an earlier server run carry another boot id, so the reaper never races new ones.
  const boot = NodeCrypto.randomUUID().slice(0, 8);
  const copiesDir = path.join(stateDir, "sandbox", "git-copies");

  // Kept in this module's table, not settings.json: only configure, which validates and audits,
  // may change what a sandboxed agent can reach.
  const recipe = sql<{ readonly recipe_json: string }>`SELECT recipe_json FROM sandbox_recipe`.pipe(
    Effect.flatMap((rows) => decodeRecipe(rows[0]?.recipe_json ?? "{}")),
    Effect.mapError(toError("Could not read the sandbox recipe.")),
  );

  const modes = sql<ModeRow>`SELECT kind, target_id, mode FROM sandbox_modes`.pipe(
    Effect.mapError(toError("Could not read which threads run in containers.")),
  );

  const threadModes = Effect.fn("ContainerSandbox.threadModes")(function* (threadId: string) {
    const thread = yield* projections
      .findThread(ThreadId.make(threadId))
      .pipe(Effect.orElseSucceed(() => null));
    const rows = yield* modes;
    const own = rows.find((row) => row.kind === "thread" && row.target_id === threadId)?.mode;
    const projectMode =
      thread === null
        ? undefined
        : rows.find((row) => row.kind === "project" && row.target_id === thread.projectId)?.mode;
    return { thread, own: own ?? null, sandboxed: (own ?? projectMode) === "on" };
  });

  const isSandboxed = (threadId: string) =>
    threadModes(threadId).pipe(
      Effect.map((resolved) => resolved.sandboxed),
      // An unreadable table must not quietly put a sandboxed thread on the host.
      Effect.orElseSucceed(() => true),
    );

  const run = (
    command: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input = "20 seconds",
  ) => runner.run({ command, args, timeout, env: hostEnvironment }).pipe(Effect.option);

  const probeDocker = Effect.gen(function* () {
    const unavailable = (reason: string) => ({ reason, ociRuntimes: [] });
    const envHost = hostEnvironment.DOCKER_HOST;
    if (envHost !== undefined && envHost !== "" && !isLocalDockerEndpoint(envHost)) {
      return unavailable(
        "DOCKER_HOST points away from this machine. CMDeck only uses the local Docker engine.",
      );
    }
    const context = yield* run("docker", [
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    if (Option.isNone(context)) return unavailable("Docker is not installed or not on PATH.");
    const host = context.value.stdout.trim();
    if (context.value.code === 0 && host !== "" && !isLocalDockerEndpoint(host)) {
      return unavailable(
        "The current Docker context points away from this machine. CMDeck only uses the local Docker engine.",
      );
    }
    const info = yield* run("docker", ["info", "--format", "{{json .Runtimes}}"]);
    if (Option.isNone(info) || info.value.code !== 0) {
      return unavailable("Docker is installed, but its engine is not running.");
    }
    return { reason: null, ociRuntimes: parseDockerRuntimes(info.value.stdout) };
  });

  const probeApple = Effect.gen(function* () {
    const hostReason = appleContainerHostReason(platform, architecture, kernelRelease);
    if (hostReason !== null) return { reason: hostReason };
    const status = yield* run("container", ["system", "status"]);
    if (Option.isNone(status)) return { reason: "Apple container is not installed." };
    return status.value.code === 0
      ? { reason: null }
      : { reason: "Apple container is installed, but its services are not running." };
  });

  const probed = yield* Ref.make<ProbedRuntimes | null>(null);
  const probe = Effect.fn("ContainerSandbox.probe")(function* (refresh: boolean) {
    const cached = yield* Ref.get(probed);
    if (cached !== null && !refresh) return cached;
    const [docker, apple] = yield* Effect.all([probeDocker, probeApple], {
      concurrency: "unbounded",
    });
    const fresh = { docker, apple };
    yield* Ref.set(probed, fresh);
    return fresh;
  });

  const readiness = Effect.fn("ContainerSandbox.readiness")(function* (refresh: boolean) {
    const current = yield* recipe;
    const cached = yield* Ref.get(probed);
    // Opening Settings on an unconfigured server starts no container CLI; asking to check does.
    const host =
      cached === null && !refresh && current.image.trim() === ""
        ? NOT_CHECKED
        : yield* probe(refresh);
    const statuses = runtimeStatuses(host, current);
    return { recipe: current, statuses, refusal: recipeRefusal(statuses, current) };
  });

  // Nothing subscribes, probes or reaps until the sandbox is in use.
  let inUse = false;
  const pendingStarts: Array<Effect.Effect<void>> = [];
  const markInUse = Effect.suspend(() => {
    if (inUse) return Effect.void;
    inUse = true;
    return Effect.forEach(pendingStarts.splice(0), (start) => start, { discard: true });
  });
  const whenInUse = (start: Effect.Effect<void>) =>
    Effect.suspend(() => {
      if (inUse) return start;
      pendingStarts.push(start);
      return Effect.void;
    });

  const listOwn = (runtime: SandboxRuntimeKind) =>
    run(RUNTIME_TRAITS[runtime].binary, listArgs(runtime, owner)).pipe(
      Effect.map((result) =>
        Option.isSome(result) && result.value.code === 0
          ? parseList(runtime, result.value.stdout, owner)
          : [],
      ),
    );

  const remove = (runtime: SandboxRuntimeKind, names: ReadonlyArray<string>) =>
    names.length === 0
      ? Effect.void
      : run(RUNTIME_TRAITS[runtime].binary, removeArgs(runtime, names)).pipe(
          Effect.andThen(
            Effect.forEach(
              names,
              (name) =>
                fileSystem
                  .remove(path.join(copiesDir, name), { recursive: true })
                  .pipe(Effect.ignore),
              { discard: true },
            ),
          ),
        );

  const reap = Effect.gen(function* () {
    const { recipe: current } = yield* readiness(false);
    const stale = (yield* listOwn(current.runtime)).filter((listed) => listed.boot !== boot);
    yield* remove(
      current.runtime,
      stale.map((listed) => listed.name),
    );
    if (stale.length > 0) {
      yield* Effect.logInfo("Removed containers left by a previous server", {
        count: stale.length,
      });
    }
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("Could not reap containers", { cause })));

  const removeThread = Effect.fn("ContainerSandbox.removeThread")(
    function* (threadId: string) {
      if (!inUse) return;
      const current = yield* recipe;
      const own = (yield* listOwn(current.runtime)).filter(
        (listed) => listed.threadId === threadId,
      );
      yield* remove(
        current.runtime,
        own.map((listed) => listed.name),
      );
      agentContainers.delete(threadId);
    },
    (effect) => Effect.ignore(effect),
  );

  const workspaceOf = Effect.fn("ContainerSandbox.workspaceOf")(function* (threadId: string) {
    const thread = yield* projections
      .findThread(ThreadId.make(threadId))
      .pipe(Effect.orElseSucceed(() => null));
    if (thread === null) return null;
    const project = yield* projects
      .get(thread.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project)) return null;
    const projectRoot = project.value.workspaceRoot;
    return { workspace: thread.worktreePath || projectRoot, projectRoot };
  });

  // A path is "real" when no link along it leads elsewhere; compared after resolving its parent.
  const isReal = (target: string) =>
    Effect.all([fileSystem.realPath(target), fileSystem.realPath(path.dirname(target))]).pipe(
      Effect.map(([resolved, parent]) => resolved === path.join(parent, path.basename(target))),
      Effect.orElseSucceed(() => false),
    );
  const readPointer = (file: string) =>
    fileSystem.readFileString(file).pipe(
      Effect.map((text) => text.trim()),
      Effect.option,
    );
  const refuseLayout = (detail: string) =>
    Effect.fail(
      new SandboxError({ detail: `The thread's git layout cannot be trusted: ${detail}` }),
    );

  /**
   * The workspace's git layout, anchored on the project's own `.git` directory on the host. Files
   * inside the workspace are the container's to write, so a `.git` file or pointer is believed only
   * when it leads back to that repository; anything else refuses the launch.
   */
  const gitLayout = Effect.fn("ContainerSandbox.gitLayout")(function* (
    workspace: string,
    projectRoot: string,
  ) {
    const dotGit = path.join(workspace, ".git");
    const info = yield* fileSystem.stat(dotGit).pipe(Effect.option);
    if (Option.isNone(info)) return null;
    if (!(yield* isReal(dotGit))) return yield* refuseLayout(".git is a link.");
    const projectGit = path.join(projectRoot, ".git");
    const projectGitReal = yield* fileSystem.realPath(projectGit).pipe(Effect.option);
    const sameAsProject =
      (yield* fileSystem.realPath(workspace).pipe(Effect.option)).pipe(Option.getOrUndefined) ===
      (yield* fileSystem.realPath(projectRoot).pipe(Effect.option)).pipe(Option.getOrUndefined);
    if (info.value.type === "Directory") {
      if (!sameAsProject) return yield* refuseLayout(".git is a directory in a linked worktree.");
      return { commonDir: dotGit, adminDir: dotGit, dotGitFile: null } satisfies GitLayout;
    }
    if (sameAsProject || Option.isNone(projectGitReal)) {
      return yield* refuseLayout(".git is not the project's repository directory.");
    }
    const commonDir = projectGitReal.value;
    const pointer = /^gitdir:\s*(.+)$/m.exec(
      (yield* readPointer(dotGit)).pipe(Option.getOrElse(() => "")),
    );
    const adminDir = yield* fileSystem
      .realPath(path.resolve(workspace, pointer?.[1]?.trim() ?? ""))
      .pipe(Effect.option);
    if (pointer === null || Option.isNone(adminDir)) return yield* refuseLayout("no gitdir.");
    if (path.dirname(adminDir.value) !== path.join(commonDir, "worktrees")) {
      return yield* refuseLayout("gitdir is outside the project's worktrees.");
    }
    const backPointer = yield* readPointer(path.join(adminDir.value, "gitdir"));
    const backReal = Option.isSome(backPointer)
      ? yield* fileSystem
          .realPath(path.resolve(adminDir.value, backPointer.value))
          .pipe(Effect.option)
      : Option.none<string>();
    const dotGitReal = yield* fileSystem.realPath(dotGit);
    if (Option.getOrUndefined(backReal) !== dotGitReal) {
      return yield* refuseLayout("the worktree's gitdir does not point back to it.");
    }
    const commonPointer = yield* readPointer(path.join(adminDir.value, "commondir"));
    const commonReal = Option.isSome(commonPointer)
      ? yield* fileSystem
          .realPath(path.resolve(adminDir.value, commonPointer.value))
          .pipe(Effect.option)
      : Option.none<string>();
    if (Option.getOrUndefined(commonReal) !== commonDir) {
      return yield* refuseLayout("commondir is not the project's repository.");
    }
    return { commonDir, adminDir: adminDir.value, dotGitFile: dotGit } satisfies GitLayout;
  });

  const inside = (child: string, parent: string) => {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const expandHome = (value: string) =>
    value === "~" || value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(homeDirectory, value.slice(1))
      : value;

  const mountsFor = Effect.fn("ContainerSandbox.mountsFor")(function* (
    workspace: string,
    projectRoot: string,
    current: SandboxRecipe,
    name: string,
  ) {
    const at = (hostPath: string, readOnly: boolean): ContainerMount => ({
      hostPath,
      containerPath: containerPathFor(hostPath, platform),
      readOnly,
    });
    const mounts: Array<ContainerMount> = [at(workspace, false)];
    const layout = yield* gitLayout(workspace, projectRoot);
    if (layout !== null) {
      // A linked worktree's objects and refs live in the main checkout's git dir.
      if (!inside(layout.commonDir, workspace)) mounts.push(at(layout.commonDir, false));
      const copy = !RUNTIME_TRAITS[current.runtime].readOnlyMounts;
      let index = 0;
      for (const target of gitProtectedPaths(layout, path.join)) {
        const exists = yield* fileSystem
          .exists(target.path)
          .pipe(Effect.orElseSucceed(() => false));
        if (exists && !(yield* isReal(target.path))) {
          return yield* refuseLayout(`${path.basename(target.path)} is a link.`);
        }
        if (!exists) {
          if (!target.create) continue;
          yield* target.kind === "dir"
            ? fileSystem.makeDirectory(target.path, { recursive: true })
            : fileSystem.writeFileString(target.path, "", { flag: "wx" }).pipe(Effect.ignore);
        }
        if (target.writable === true || !copy) {
          mounts.push(at(target.path, target.writable !== true));
          continue;
        }
        // Apple cannot mount read-only: the container gets a copy, and its writes stay in the copy.
        const copied = path.join(copiesDir, name, `${index++}-${path.basename(target.path)}`);
        yield* fileSystem.makeDirectory(path.dirname(copied), { recursive: true });
        // Hooks only matter to git on the host, and a copied link could read any host file.
        yield* target.kind === "dir"
          ? fileSystem.makeDirectory(copied)
          : fileSystem.copyFile(target.path, copied);
        mounts.push({
          hostPath: copied,
          containerPath: containerPathFor(target.path, platform),
          readOnly: false,
        });
      }
    }
    for (const extra of current.mounts) mounts.push(at(expandHome(extra.hostPath), extra.readOnly));
    // Parents first, so a read-only overlay always lands on top of the mount that contains it.
    const depth = (mount: ContainerMount) => mount.containerPath.split(/[\\/]/).length;
    return mounts.toSorted((a, b) => depth(a) - depth(b));
  });

  // Agent containers per thread, for `kill`. Terminals are not the agent and are never killed here.
  const agentContainers = new Map<string, string>();

  const launch = Effect.fn("ContainerSandbox.launch")(function* (
    threadId: string,
    input: Parameters<AgentScopeShape["wrap"]>[0],
  ) {
    const { recipe: current, refusal } = yield* readiness(false);
    if (refusal !== null) return yield* new SandboxError({ detail: refusal });
    const env = input.env ?? hostEnvironment;
    const envHost = env.DOCKER_HOST;
    if (
      (envHost !== undefined && envHost !== "" && !isLocalDockerEndpoint(envHost)) ||
      env.DOCKER_CONTEXT !== hostEnvironment.DOCKER_CONTEXT
    ) {
      return yield* new SandboxError({
        detail:
          "This launch's environment points Docker at another engine. CMDeck only uses the local one.",
      });
    }
    const located = yield* workspaceOf(threadId);
    if (located === null) {
      return yield* new SandboxError({ detail: "The thread has no workspace to mount." });
    }
    const { workspace, projectRoot } = located;
    const name = `cmdeck-${input.name}-${NodeCrypto.randomUUID().slice(0, 12)}`;
    const mounts = yield* mountsFor(workspace, projectRoot, current, name).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.fail(
            new SandboxError({ detail: "Could not prepare the container's mounts.", cause }),
          ),
      }),
    );
    const inContainer = containerCommand(input.name, input.command, input.args);
    const binary = RUNTIME_TRAITS[current.runtime].binary;
    const resolved = yield* resolveCommandPath(binary, { env }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.Platform, platform),
      Effect.orElseSucceed(() => null),
    );
    const args = runArgs({
      runtime: current.runtime,
      name,
      image: current.image,
      labels: { [LABEL_THREAD]: threadId, [LABEL_OWNER]: owner, [LABEL_BOOT]: boot },
      workdir: containerPathFor(workspace, platform),
      mounts,
      envKeys: forwardedEnvKeys(env, current.env),
      network: current.network,
      ociRuntime: current.ociRuntime,
      cpus: current.cpus,
      memory: current.memory,
      user:
        platform === "linux" && current.runtime === "docker" && userId !== undefined
          ? `${userId}:${process.getgid?.() ?? userId}`
          : null,
      // A terminal's pseudo-terminal is already a TTY; the agent speaks JSON over pipes.
      tty: input.name === "terminal",
      command: inContainer.command,
      args: inContainer.args,
    });
    if (input.name !== "terminal") agentContainers.set(threadId, name);
    yield* markInUse;
    return { command: resolved ?? binary, args, unit: name };
  });

  const wrap: AgentScopeShape["wrap"] = Effect.fn("ContainerSandbox.wrap")(function* (input) {
    // A shared process (Codex's app-server) serves other threads, so it never runs in one's container.
    const threadId =
      input.shared === true ? undefined : (input.threadId ?? input.env?.[AGENT_THREAD_ENV]);
    if (threadId === undefined || !(yield* isSandboxed(threadId))) return yield* inner.wrap(input);
    // Fail closed: a sandboxed thread never falls back to the host. Session open refuses first.
    return yield* launch(threadId, input).pipe(Effect.orDie);
  });

  const scope: AgentScopeShape = {
    wrap,
    oomKilled: inner.oomKilled,
    stop: (unit) =>
      unit.startsWith("cmdeck-")
        ? recipe.pipe(
            Effect.flatMap((current) => remove(current.runtime, [unit])),
            Effect.ignore,
          )
        : inner.stop(unit),
    kill: Effect.fn("ContainerSandbox.kill")(function* (threadId) {
      const name = agentContainers.get(threadId);
      if (name === undefined) return yield* inner.kill(threadId);
      const current = yield* recipe.pipe(Effect.orElseSucceed(() => null));
      if (current === null) return false;
      const killed = yield* run(RUNTIME_TRAITS[current.runtime].binary, ["kill", name]);
      return Option.isSome(killed) && killed.value.code === 0;
    }),
    clear: (threadId) =>
      Effect.sync(() => agentContainers.delete(threadId)).pipe(
        Effect.andThen(inner.clear(threadId)),
      ),
  };

  const status = Effect.fn("ContainerSandbox.status")(function* (input: SandboxStatusInput) {
    const ready = yield* readiness(input.refresh === true);
    const rows = yield* modes;
    const thread =
      input.threadId === undefined
        ? null
        : yield* threadModes(input.threadId).pipe(
            Effect.map((resolved) => ({
              threadId: ThreadId.make(input.threadId ?? ""),
              mode: resolved.own,
              sandboxed: resolved.sandboxed,
            })),
          );
    return {
      recipe: ready.recipe,
      ready: ready.refusal === null,
      runtimes: ready.statuses,
      projects: rows
        .filter((row) => row.kind === "project")
        .map((row) => ({ projectId: row.target_id as ProjectId, mode: row.mode })),
      thread,
    } satisfies SandboxStatus;
  });

  const setMode = Effect.fn("ContainerSandbox.setMode")(function* (
    kind: ModeRow["kind"],
    targetId: string,
    mode: SandboxMode | null,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* (
      mode === null
        ? sql`DELETE FROM sandbox_modes WHERE kind = ${kind} AND target_id = ${targetId}`
        : sql`INSERT INTO sandbox_modes (kind, target_id, mode, updated_at)
          VALUES (${kind}, ${targetId}, ${mode}, ${now})
          ON CONFLICT (kind, target_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`
    ).pipe(Effect.mapError(toError("Could not save the sandbox choice.")));
  });

  const configure = Effect.fn("ContainerSandbox.configure")(function* (
    input: SandboxConfigureInput,
    actor: string,
  ) {
    // Each read-compare-write runs in one transaction, so a concurrent change cannot slip an
    // opt-out past the audit. The entry is written after the commit: AuditLog takes its own lock
    // and then a transaction, so appending inside this one could deadlock against another append.
    const atomically = <A>(effect: Effect.Effect<A, SandboxError>) =>
      sql.withTransaction(effect).pipe(
        Effect.catchTags({
          SqlError: (cause) =>
            Effect.fail(new SandboxError({ detail: "Could not save the sandbox choice.", cause })),
        }),
      );
    if (input.recipe !== undefined) {
      const next = input.recipe;
      if (next.ociRuntime !== null && next.runtime !== "docker") {
        return yield* new SandboxError({ detail: "An OCI runtime applies to Docker only." });
      }
      if (next.network.trim() === "") {
        return yield* new SandboxError({ detail: "Choose a network, or none." });
      }
      const opened = yield* atomically(
        Effect.gen(function* () {
          const previous = yield* recipe;
          const now = DateTime.formatIso(yield* DateTime.now);
          const json = yield* encodeRecipe(next).pipe(
            Effect.mapError(toError("Could not save the sandbox recipe.")),
          );
          yield* sql`INSERT INTO sandbox_recipe (id, recipe_json, updated_at) VALUES (1, ${json}, ${now})
            ON CONFLICT (id) DO UPDATE SET recipe_json = excluded.recipe_json, updated_at = excluded.updated_at`.pipe(
            Effect.mapError(toError("Could not save the sandbox recipe.")),
          );
          return next.network !== "none" && next.network !== previous.network;
        }),
      );
      if (opened) {
        yield* audit.append({
          kind: "sandbox.network_opened",
          actor,
          subject: next.network,
          detail: { runtime: next.runtime },
        });
      }
    }
    const optedOut = (subject: string, scope: "project" | "thread") =>
      audit.append({ kind: "sandbox.opted_out", actor, subject, detail: { scope } });
    if (input.project !== undefined) {
      const { projectId, mode } = input.project;
      const turnedOff = yield* atomically(
        Effect.gen(function* () {
          const before = (yield* modes).find(
            (row) => row.kind === "project" && row.target_id === projectId,
          )?.mode;
          yield* setMode("project", projectId, mode === "on" ? "on" : null);
          return before === "on" && mode === "off";
        }),
      );
      if (turnedOff) yield* optedOut(projectId, "project");
    }
    if (input.thread !== undefined) {
      const { threadId, mode } = input.thread;
      const turnedOff = yield* atomically(
        Effect.gen(function* () {
          const before = yield* threadModes(threadId);
          yield* setMode("thread", threadId, mode);
          const after = yield* threadModes(threadId);
          return before.sandboxed && !after.sandboxed;
        }),
      );
      if (turnedOff) yield* optedOut(threadId, "thread");
    }
    return yield* status(input.thread === undefined ? {} : { threadId: input.thread.threadId });
  });

  const launchRefusal = Effect.fn("ContainerSandbox.launchRefusal")(function* (
    threadId: string,
    driver: string,
  ) {
    if (!(yield* isSandboxed(threadId))) return null;
    if (!CONTAINER_DRIVERS.has(driver)) {
      return `This thread runs in a container, and ${driver} cannot start inside one yet: only Claude runs one process per thread. Switch to Claude, or turn the container off for this thread.`;
    }
    return yield* readiness(false).pipe(
      Effect.map((ready) => ready.refusal),
      Effect.orElseSucceed(() => "Could not read the sandbox settings."),
    );
  });

  // Reap only where containers were used: a fresh install spawns no container CLI at start-up.
  const used = yield* Effect.all([recipe, modes]).pipe(
    Effect.map(
      ([current, rows]) => current.image.trim() !== "" && rows.some((row) => row.mode === "on"),
    ),
    Effect.orElseSucceed(() => false),
  );
  if (used) {
    yield* markInUse;
    yield* fileSystem.remove(copiesDir, { recursive: true }).pipe(Effect.ignore);
    yield* reap.pipe(Effect.forkIn(layerScope));
  }

  return {
    scope,
    service: ContainerSandbox.of({
      status,
      configure,
      isSandboxed,
      launchRefusal,
      removeThread,
      whenInUse,
    }),
  };
});

/**
 * For a provider adapter, read at its build: whether a thread runs in a container. Absent the
 * service (tests, upstream builds), no thread does.
 */
export const sandboxedThreadCheck = Effect.map(
  Effect.serviceOption(ContainerSandbox),
  (sandbox) => (threadId: string) =>
    Option.isSome(sandbox) ? sandbox.value.isSandboxed(threadId) : Effect.succeed(false),
);

/** The service and the AgentScope it wraps, without the stores it reads (tests provide fakes). */
export const layerCore = Layer.effectContext(
  make.pipe(
    Effect.map(({ scope, service }) =>
      Context.make(ContainerSandbox, service).pipe(Context.add(AgentScope, scope)),
    ),
  ),
);

/**
 * Wraps whichever AgentScope lies beneath (systemd on Linux) and provides the sandbox service.
 * `server.ts` provides it right above that AgentScope, with the settings layer for its database.
 */
export const layer = layerCore.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProjectionStore.layer,
      ProjectStore.layer,
      AuditLog.layerService,
      ProcessRunner.layer,
    ),
  ),
);
