import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as WorkflowTrust from "./WorkflowTrust.ts";

it.effect(
  "an approval covers exact bytes: a change revokes it, and reverting does not restore it",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // One database and audit log for the test and the gate.
      const services = yield* Layer.build(
        Layer.merge(WorkflowTrust.layer, AuditLog.layerService).pipe(
          Layer.provide(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer)),
        ),
      );
      const trust = Context.get(services, WorkflowTrust.WorkflowTrust);
      const audit = Context.get(services, AuditLog.AuditLog);
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-trust-" });
      const file = path.join(directory, "flow.ts");
      // What `load` was handed, and what that file held when it was.
      const loaded: Array<[string, string]> = [];
      const load = (from: string) =>
        Effect.map(fileSystem.readFileString(from), (text) => {
          loaded.push([from, text]);
          return { definitions: [], problem: undefined };
        }).pipe(Effect.orDie);

      yield* fileSystem.writeFileString(file, "v1");
      const withheld = yield* trust.gated(file, load);
      assert.equal(withheld.problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      assert.deepStrictEqual(loaded, []);
      const [shown] = yield* trust.pending;
      assert.equal(shown?.source, "v1");
      yield* trust.approve(shown!.path, shown!.sha256);

      yield* trust.gated(file, load);
      // A copy of the approved bytes, never the file another write could have changed since.
      assert.deepStrictEqual(
        loaded.map(([from, text]) => [from === file, text]),
        [[false, "v1"]],
      );

      yield* fileSystem.writeFileString(file, "v2");
      assert.equal((yield* trust.gated(file, load)).problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      yield* fileSystem.writeFileString(file, "v1");
      assert.equal((yield* trust.gated(file, load)).problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      assert.equal(loaded.length, 1);
      assert.include(
        (yield* Effect.flip(trust.approve(path.join(directory, "x.ts"), "0"))).message,
        "not waiting",
      );

      // Saved in the editor: approved as a person's, once.
      yield* trust.record(directory, "flow.ts", "v1", "user");
      yield* trust.record(directory, "flow.ts", "v1", "user");
      assert.deepStrictEqual(yield* trust.pending, []);

      const kinds = (yield* audit.list({})).entries.map((entry) => entry.kind).toReversed();
      assert.deepStrictEqual(kinds, [
        "workflow.approved",
        "workflow.approval_revoked",
        "workflow.approved",
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
