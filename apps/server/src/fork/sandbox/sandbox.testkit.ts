import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationV2AppThread,
  ProjectId,
  type SandboxRecipe,
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
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { layerCore } from "./ContainerSandbox.ts";

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
  readonly listed?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Threads already in containers before this start. */
  readonly sandboxedBefore?: ReadonlyArray<string>;
  /** Runs the real container CLI on this host instead of the fake (the live test). */
  readonly realHost?: boolean;
  /** A fixed server home, so two starts share one owner label. */
  readonly baseDir?: string;
}) => {
  const run: ProcessRunner.ProcessRunner["Service"]["run"] = (input) => {
    options.host.calls.push([input.command, ...input.args]);
    if (input.command !== "docker") return Effect.fail(notFound(input.command));
    if (options.docker === false) return Effect.fail(notFound(input.command));
    switch (input.args[0]) {
      case "context":
        return Effect.succeed(output("unix:///var/run/docker.sock\n"));
      case "info":
        return Effect.succeed(output('{"runc":{},"runsc":{}}'));
      case "ps":
        return Effect.succeed(output(options.listed ?? ""));
      case "rm":
        return Deferred.succeed(options.host.removed, input.args.slice(2)).pipe(
          Effect.as(output("")),
        );
      default:
        return Effect.succeed(output(""));
    }
  };
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
        options.realHost === true
          ? ProcessRunner.layer
          : Layer.succeed(ProcessRunner.ProcessRunner, { run }),
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
        Layer.mock(ProjectStore.ProjectStoreV2)({ get: () => Effect.succeedNone }),
        AuditLog.layerService,
        ServerSettings.layerTest({
          cmdeck: { sandbox: { image: "acme/agent:1", ...options.recipe } },
        }),
        Layer.succeed(AgentScope, inner),
        // The real host keeps the platform and environment references' own defaults.
        options.realHost === true
          ? Layer.empty
          : Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "linux"),
              Layer.succeed(HostProcess.Environment, options.env ?? { PATH: "" }),
            ),
      ),
    ),
    Layer.provide(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
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

/** A temporary checkout with a `.git` dir, as a main worktree has. */
export const makeWorkspace = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cmdeck-sandbox-ws-" });
  yield* fileSystem.makeDirectory(path.join(workspace, ".git"));
  yield* fileSystem.writeFileString(path.join(workspace, ".git", "config"), "[core]\n");
  return workspace;
});
