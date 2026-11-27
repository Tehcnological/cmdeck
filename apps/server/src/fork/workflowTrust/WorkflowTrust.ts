// Fork-only. A workflow file runs in the server with its rights, so it is imported only once a
// person approved its exact bytes (WI-1.06). Approved code is not sandboxed: approval is the boundary.
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

import {
  type PendingWorkflowFile,
  type WorkflowDefinitionProblem,
  WORKFLOW_NEEDS_APPROVAL,
  WorkflowTrustError,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as AuditLog from "../audit/AuditLog.ts";

export const NEEDS_APPROVAL = WORKFLOW_NEEDS_APPROVAL;

export type TrustSource = "preset" | "user";

// Approved bytes by file address, served in place of what is on disk while that file loads.
const serving = new Map<string, Uint8Array>();
let hooked = false;
const serveApproved = () => {
  if (hooked) return;
  hooked = true;
  NodeModule.registerHooks({
    load(url, context, next) {
      const source = serving.size === 0 ? undefined : serving.get(url.replace(/[?#].*$/s, ""));
      return source === undefined ? next(url, context) : { ...next(url, context), source };
    },
  });
};

/** What a file that is not approved loads as. Shaped like a failed load, so the runtime reports it. */
export interface Withheld {
  readonly problem: WorkflowDefinitionProblem;
  readonly definitions?: undefined;
}

export class WorkflowTrust extends Context.Service<
  WorkflowTrust,
  {
    /**
     * `load` `file` when its bytes are approved. While `load` runs, importing `file` gets the
     * approved bytes, so a write after the check cannot swap what runs. A change loses approval.
     */
    readonly gated: <A>(
      file: string,
      load: (from: string) => Effect.Effect<A>,
    ) => Effect.Effect<A | Withheld>;
    /** Files held back since they were last looked at, as they are on disk now. */
    readonly pending: Effect.Effect<ReadonlyArray<PendingWorkflowFile>>;
    /** Approves a held-back file, only while its bytes still hash to `sha256`. */
    readonly approve: (file: string, sha256: string) => Effect.Effect<void, WorkflowTrustError>;
    /** Approves `source` as the file `name` in `directory`, for a save in the editor or a preset. */
    readonly record: (
      directory: string,
      name: string,
      source: string,
      from: TrustSource,
    ) => Effect.Effect<void>;
    /** Each file approved while it was held back, for the runtime to load it. */
    readonly approvals: Stream.Stream<string>;
  }
>()("t3/fork/workflowTrust/WorkflowTrust") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const digester = yield* Digest.Digest;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const audit = yield* AuditLog.AuditLog;
  const approved = yield* PubSub.unbounded<string>();
  const held = new Set<string>();

  const hash = (bytes: Uint8Array) =>
    digester.digest(Digest.sha256, bytes).pipe(Effect.orDie, Effect.map(Hex.encode));
  const approvalOf = (file: string) =>
    sql<{ readonly sha256: string }>`SELECT sha256 FROM workflow_trust WHERE path = ${file}`.pipe(
      Effect.map((rows) => rows[0]?.sha256),
    );
  const store = Effect.fn("WorkflowTrust.store")(function* (
    file: string,
    sha256: string,
    from: TrustSource,
  ) {
    const at = yield* Clock.currentTimeMillis;
    yield* sql`INSERT INTO workflow_trust (path, sha256, source, approved_at)
      VALUES (${file}, ${sha256}, ${from}, ${at})
      ON CONFLICT (path) DO UPDATE SET sha256 = excluded.sha256, source = excluded.source,
        approved_at = excluded.approved_at`;
    yield* audit.append({ kind: "workflow.approved", subject: file, detail: { sha256, from } });
    if (held.delete(file)) yield* PubSub.publish(approved, file);
  });

  const gated = <A>(file: string, load: (from: string) => Effect.Effect<A>) => {
    const withheld = (message: string): Withheld => ({
      problem: { message, file: path.basename(file) },
    });
    return Effect.gen(function* () {
      const bytes = yield* fileSystem.readFile(file).pipe(Effect.option);
      if (bytes._tag === "None") return withheld("It could not be read.");
      const sha256 = yield* hash(bytes.value);
      const trusted = yield* approvalOf(file);
      if (trusted === sha256) {
        held.delete(file);
        serveApproved();
        const address = NodeURL.pathToFileURL(path.resolve(file)).href;
        serving.set(address, bytes.value);
        return yield* load(file).pipe(Effect.ensuring(Effect.sync(() => serving.delete(address))));
      }
      if (trusted !== undefined) {
        yield* sql`DELETE FROM workflow_trust WHERE path = ${file}`;
        yield* audit.append({
          kind: "workflow.approval_revoked",
          subject: file,
          detail: { approved: trusted, now: sha256 },
        });
      }
      held.add(file);
      return withheld(NEEDS_APPROVAL);
    }).pipe(
      Effect.catch((cause) =>
        Effect.as(
          Effect.logWarning("Could not check a workflow file's approval", { file, cause }),
          withheld("Its approval could not be checked."),
        ),
      ),
    );
  };

  const pending = Effect.suspend(() =>
    Effect.forEach([...held], (file) =>
      Effect.gen(function* () {
        const bytes = yield* fileSystem.readFile(file);
        const sha256 = yield* hash(bytes);
        return [
          {
            name: path.basename(file),
            path: file,
            sha256,
            source: new TextDecoder().decode(bytes),
          },
        ];
      }).pipe(
        // Kept while unreadable: an editor's atomic save briefly leaves no file to read.
        Effect.orElseSucceed(() => []),
      ),
    ).pipe(Effect.map((files) => files.flat())),
  );

  const approve = Effect.fn("WorkflowTrust.approve")(
    function* (file: string, sha256: string) {
      if (!held.has(file)) {
        return yield* new WorkflowTrustError({ reason: "That file is not waiting for approval." });
      }
      const now = yield* fileSystem.readFile(file).pipe(Effect.flatMap(hash));
      if (now !== sha256) {
        return yield* new WorkflowTrustError({
          reason: "The file changed after it was shown. Review it again before approving.",
        });
      }
      yield* store(file, sha256, "user");
    },
    Effect.catchTags({
      PlatformError: () =>
        Effect.fail(new WorkflowTrustError({ reason: "The file could not be read." })),
      SqlError: Effect.die,
    }),
  );

  const record = Effect.fn("WorkflowTrust.record")(function* (
    directory: string,
    name: string,
    source: string,
    from: TrustSource,
  ) {
    const file = path.join(directory, name);
    const sha256 = yield* hash(new TextEncoder().encode(source));
    if ((yield* approvalOf(file)) === sha256) return;
    yield* store(file, sha256, from);
  }, Effect.orDie);

  return WorkflowTrust.of({
    gated,
    pending,
    approve,
    record,
    approvals: Stream.fromPubSub(approved),
  });
});

/**
 * Below the workflow runtime, which gates on it. It writes to the audit log ForkLayer builds:
 * layers memoize by reference, so `AuditLog.layerService` is one instance for both.
 */
export const layer = Layer.effect(WorkflowTrust, make).pipe(Layer.provide(AuditLog.layerService));

/**
 * Runtime hook: when a file in `directory` is approved, forget it was `seen` so `reload` loads it,
 * for as long as the calling scope lasts.
 */
export const onApproved = Effect.fn("WorkflowTrust.onApproved")(function* <E>(
  directory: string,
  seen: Map<string, unknown>,
  reload: Effect.Effect<unknown, E>,
) {
  const trust = yield* WorkflowTrust;
  const path = yield* Path.Path;
  yield* trust.approvals.pipe(
    Stream.filter((file) => path.dirname(file) === directory),
    Stream.runForEach((file) => {
      seen.delete(path.basename(file));
      return reload.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.logWarning("Reloading an approved workflow file failed", cause),
        ),
      );
    }),
    Effect.forkScoped,
  );
});
