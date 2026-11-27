import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "../baseSchemas.ts";

/** `docker`: the local Docker CLI on any OS. `apple`: Apple's `container` CLI on macOS 26, Apple silicon. */
export const SandboxRuntimeKind = Schema.Literals(["docker", "apple"]);
export type SandboxRuntimeKind = typeof SandboxRuntimeKind.Type;

export const SandboxMount = Schema.Struct({
  /** Mounted at the same absolute path in the container (a drive path maps to /c/... on Windows). */
  hostPath: Schema.String.check(Schema.isMinLength(1)),
  readOnly: Schema.Boolean,
});
export type SandboxMount = typeof SandboxMount.Type;

/** The one recipe every sandboxed thread runs with, under `cmdeck.sandbox`. */
export const SandboxRecipe = Schema.Struct({
  runtime: SandboxRuntimeKind.pipe(Schema.withDecodingDefault(Effect.succeed("docker"))),
  /** An OCI runtime Docker lists in `docker info`, such as `runsc` (gVisor). Docker only. */
  ociRuntime: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Must contain the provider CLI (`claude`) and a shell. Empty leaves the sandbox off. */
  image: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** `none` turns networking off, which also stops the agent reaching its model API. */
  network: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("none"))),
  cpus: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  memory: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** Extra host paths, such as `~/.claude`; `~/.ssh` and `~/.aws` are never mounted unless listed. */
  mounts: Schema.Array(SandboxMount).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Environment variable names passed through by name, beyond the provider credentials. */
  env: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type SandboxRecipe = typeof SandboxRecipe.Type;

export const SandboxRuntimeStatus = Schema.Struct({
  kind: SandboxRuntimeKind,
  available: Schema.Boolean,
  /** Why it cannot be used; shown next to the disabled option. */
  reason: Schema.NullOr(Schema.String),
  /** OCI runtimes Docker reports, such as `runc` and `runsc`. */
  ociRuntimes: Schema.Array(Schema.String),
  /** Apple `container` cannot mount read-only, so `.git` config and hooks are copies there. */
  gitOverlayIsCopy: Schema.Boolean,
});
export type SandboxRuntimeStatus = typeof SandboxRuntimeStatus.Type;

export const SandboxMode = Schema.Literals(["on", "off"]);
export type SandboxMode = typeof SandboxMode.Type;

export const SandboxStatus = Schema.Struct({
  recipe: SandboxRecipe,
  /** The configured runtime can start containers now; false explains itself in `runtimes`. */
  ready: Schema.Boolean,
  runtimes: Schema.Array(SandboxRuntimeStatus),
  projects: Schema.Array(Schema.Struct({ projectId: ProjectId, mode: SandboxMode })),
  thread: Schema.NullOr(
    Schema.Struct({
      threadId: ThreadId,
      /** The thread's own choice; null follows its project. */
      mode: Schema.NullOr(SandboxMode),
      /** Whether its provider and terminals start in a container. */
      sandboxed: Schema.Boolean,
    }),
  ),
});
export type SandboxStatus = typeof SandboxStatus.Type;

export const SandboxStatusInput = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  /** Probe the runtimes again instead of using this server's last answer. */
  refresh: Schema.optionalKey(Schema.Boolean),
});
export type SandboxStatusInput = typeof SandboxStatusInput.Type;

/** A null mode clears a thread's own choice, so it follows its project again. */
export const SandboxConfigureInput = Schema.Struct({
  recipe: Schema.optionalKey(SandboxRecipe),
  project: Schema.optionalKey(Schema.Struct({ projectId: ProjectId, mode: SandboxMode })),
  thread: Schema.optionalKey(
    Schema.Struct({ threadId: ThreadId, mode: Schema.NullOr(SandboxMode) }),
  ),
});
export type SandboxConfigureInput = typeof SandboxConfigureInput.Type;

export class SandboxError extends Schema.TaggedError<SandboxError>()("SandboxError", {
  detail: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}
