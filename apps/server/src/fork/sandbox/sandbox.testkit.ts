// @effect-diagnostics nodeBuiltinImport:off -- test repositories are made with the git CLI.
import * as NodeChildProcess from "node:child_process";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationV2AppThread,
  ProjectId,
  SandboxRecipe,
  ThreadId,
} from "@t3tools/contracts";
import { AgentScope, type AgentScopeShape } from "@t3tools/shared/AgentScope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { layerCore } from "./ContainerSandbox.ts";
import { CaseInsensitiveWorkspace } from "./privateGit.ts";

const decodeRecipe = Schema.decodeEffect(SandboxRecipe);
const encodeRecipeJson = Schema.encodeEffect(Schema.fromJsonString(SandboxRecipe));

export const THREAD = ThreadId.make("thread-1");
export const PROJECT = ProjectId.make("project-1");

const output = (stdout: string, code = 0): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const notFound = (command: string) =>
  new ProcessRunner.ProcessSpawnError({
    command,
    argumentCount: 0,
    cause: PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
  });

export interface Host {
  readonly calls: Array<ReadonlyArray<string>>;
  readonly innerWraps: Array<string>;
  readonly removed: Deferred.Deferred<ReadonlyArray<string>>;
}

/** A host with Docker (and runsc) unless `docker` is false; `listed` is what `docker ps` returns. */
export const layerSandbox = (options: {
  readonly workspace: string;
  readonly host: Host;
  readonly recipe?: Partial<SandboxRecipe>;
  readonly docker?: boolean;
  /** What `docker context inspect` prints and exits with; a local socket by default. */
  readonly context?: { readonly stdout: string; readonly code: number };
  readonly platform?: NodeJS.Platform;
  readonly listed?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Threads already in containers before this start. */
  readonly sandboxedBefore?: ReadonlyArray<string>;
  /** Replaces the audit log, for tests that watch how entries are written. */
  readonly audit?: Layer.Layer<AuditLog.AuditLog, never, SqlClient.SqlClient>;
  /** The project's checkout; defaults to the workspace (a thread in the main checkout). */
  readonly projectRoot?: string;
  /** Runs the real container CLI on this host instead of the fake (the live test). */
  readonly realHost?: boolean;
  /** A fixed server home, so two starts share one owner label. */
  readonly baseDir?: string;
  /** Use this host's real case check; by default a worktree counts as case-sensitive. */
  readonly realCaseCheck?: boolean;
}) => {
  const fakeDocker = (input: ProcessRunner.ProcessRunInput) => {
    options.host.calls.push([input.command, ...input.args]);
    if (input.command !== "docker") return Effect.fail(notFound(input.command));
    if (options.docker === false) return Effect.fail(notFound(input.command));
    // Commands pinned to the verified engine start with `-H <endpoint>`.
    const args = input.args[0] === "-H" ? input.args.slice(2) : input.args;
    switch (args[0]) {
      case "context":
        return Effect.succeed(
          output(
            options.context?.stdout ?? "unix:///var/run/docker.sock\n",
            options.context?.code ?? 0,
          ),
        );
      case "info":
        return Effect.succeed(output('{"runc":{},"runsc":{}}'));
      case "ps":
        return Effect.succeed(output(options.listed ?? ""));
      case "rm":
        return Deferred.succeed(options.host.removed, args.slice(2)).pipe(Effect.as(output("")));
      default:
        return Effect.succeed(output(""));
    }
  };
  // git is real, so seeding and importing run against real repositories.
  const layerRunner = Layer.effect(
    ProcessRunner.ProcessRunner,
    Effect.map(ProcessRunner.make(), (real) => ({
      run: (input: ProcessRunner.ProcessRunInput) =>
        input.command === "git" ? real.run(input) : fakeDocker(input),
    })),
  );
  const inner: AgentScopeShape = {
    ...AgentScope.defaultValue(),
    wrap: (input) =>
      Effect.sync(() => {
        options.host.innerWraps.push(input.name);
        return { command: input.command, args: input.args };
      }),
  };
  return layerCore.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        options.realHost === true ? ProcessRunner.layer : layerRunner,
        options.realCaseCheck === true
          ? Layer.empty
          : Layer.succeed(CaseInsensitiveWorkspace, () => Effect.succeed(false)),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          findThread: (threadId) =>
            Effect.succeed(
              threadId === THREAD
                ? ({ projectId: PROJECT, worktreePath: options.workspace } as Pick<
                    OrchestrationV2AppThread,
                    "projectId" | "worktreePath"
                  > as OrchestrationV2AppThread)
                : null,
            ),
        }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () =>
            Effect.succeedSome({
              workspaceRoot: options.projectRoot ?? options.workspace,
            } as ProjectStore.ProjectRow),
        }),
        options.audit ?? AuditLog.layerService,
        Layer.succeed(AgentScope, inner),
        // The real host keeps the platform and environment references' own defaults.
        options.realHost === true
          ? Layer.empty
          : Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, options.platform ?? "linux"),
              Layer.succeed(HostProcess.Environment, options.env ?? { PATH: "" }),
            ),
      ),
    ),
    Layer.provide(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const recipe = yield* decodeRecipe({
            image: "acme/agent:1",
            ...options.recipe,
          }).pipe(Effect.flatMap(encodeRecipeJson));
          yield* sql`INSERT INTO sandbox_recipe VALUES (1, ${recipe}, '2026-11-27T00:00:00Z')`;
          for (const threadId of options.sandboxedBefore ?? []) {
            yield* sql`INSERT INTO sandbox_modes VALUES ('thread', ${threadId}, 'on', '2026-11-27T00:00:00Z')`;
          }
        }),
      ),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), options.baseDir ?? { prefix: "cmdeck-sandbox-test-" }),
    ),
    Layer.provideMerge(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
  );
};

export const makeHost = Effect.gen(function* () {
  return {
    calls: [],
    innerWraps: [],
    removed: yield* Deferred.make<ReadonlyArray<string>>(),
  } satisfies Host;
});

export const gitIn = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.sync(() =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "core.autocrlf=false", ...args],
      { cwd, encoding: "utf8" },
    ).trim(),
  );

/** The thread's private git dir, as the agent inside the container writes it. */
export const privateDirOf = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  return (yield* Path.Path).join(stateDir, "sandbox", "git", THREAD);
});

/** A temporary repository with one commit, as a thread's main checkout has. */
export const makeWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-sandbox-ws-" });
  yield* gitIn(workspace, ["init", "-q", "-b", "main"]);
  yield* fileSystem.writeFileString(path.join(workspace, "README.md"), "hello\n");
  yield* gitIn(workspace, ["add", "README.md"]);
  yield* gitIn(workspace, ["commit", "-q", "-m", "start"]);
  return workspace;
});
