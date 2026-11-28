import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../../orchestration-v2/ThreadLaunchService.ts";
import * as RemoteDelegation from "../../peer/RemoteDelegation.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as CheckScripts from "./CheckScripts.ts";

export const PROJECT_DIR = "/home/user/app";

export interface FakeRun {
  readonly code?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
}

/** A process runner that records each call and answers with what `next` holds. */
export const makeFakeRunner = Effect.gen(function* () {
  const calls = yield* Ref.make<ReadonlyArray<ProcessRunner.ProcessRunInput>>([]);
  const next = yield* Ref.make<FakeRun>({ code: 0 });
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Ref.update(calls, (current) => [...current, input]).pipe(
        Effect.andThen(Ref.get(next)),
        Effect.map((run) => ({
          stdout: run.stdout ?? "",
          stderr: run.stderr ?? "",
          code: (run.timedOut === true ? null : (run.code ?? 0)) as never,
          timedOut: run.timedOut ?? false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        })),
      ),
  });
  return { calls, next, runner };
});

/** The real check scripts over the caller's database, with a fake runner and one project. */
export const layerTest = (runner: ProcessRunner.ProcessRunner["Service"]) =>
  CheckScripts.layerWithRunner.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner.ProcessRunner, runner),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () => Effect.succeedSome({ workspaceRoot: PROJECT_DIR } as never),
        }),
        ServerConfig.layerTest(PROJECT_DIR, { prefix: "cmdeck-check-scripts-" }),
        NodeCrypto.layer,
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

/**
 * What the orchestrator service behind `set_scheduled_task_check` needs, as stubs; thread records
 * come from the caller's ThreadManagementService. `scheduledTasks` serves the task list.
 */
export const layerOrchestratorMcpStubs = (
  scheduledTasks: Partial<ScheduledTaskService.ScheduledTaskService["Service"]> = {},
) =>
  Layer.mergeAll(
    NodeCrypto.layer,
    ServerSettings.layerTest(),
    Layer.mock(ScheduledTaskService.ScheduledTaskService)(scheduledTasks),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
      list: () => Effect.succeed([]),
    }),
    Layer.mock(ProjectService.ProjectService)({}),
    Layer.mock(SecretRequests.SecretRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
  );
