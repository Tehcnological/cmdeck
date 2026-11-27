import * as NodeModule from "node:module";

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
      const v1 = `import { tag } from "./lib/tag.ts";
export default tag("v1");
`;
      const v2 = `export default "v2";
`;
      yield* fileSystem.makeDirectory(path.join(directory, "lib"));
      yield* fileSystem.writeFileString(
        path.join(directory, "lib", "tag.ts"),
        `export const tag = (text: string): string => "approved " + text;
`,
      );
      // What each load imported. An agent's write lands between the check and the import.
      const loaded: Array<unknown> = [];
      const load = (from: string) =>
        Effect.gen(function* () {
          yield* fileSystem.writeFileString(from, v2);
          // Node's own loader: the test runner's `import()` skips Node's module hooks.
          const imported = NodeModule.createRequire(from)(from) as { default: unknown };
          loaded.push(imported.default);
          return { definitions: [], problem: undefined };
        }).pipe(Effect.orDie);

      yield* fileSystem.writeFileString(file, v1);
      const withheld = yield* trust.gated(file, load);
      assert.equal(withheld.problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      assert.deepStrictEqual(loaded, []);
      const [shown] = yield* trust.pending;
      assert.equal(shown?.source, v1);
      yield* trust.approve(shown!.path, shown!.sha256);

      yield* trust.gated(file, load);
      // The approved bytes ran, still able to import beside them, though the file changed first.
      assert.deepStrictEqual(loaded, ["approved v1"]);

      assert.equal((yield* trust.gated(file, load)).problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      yield* fileSystem.writeFileString(file, v1);
      assert.equal((yield* trust.gated(file, load)).problem?.message, WorkflowTrust.NEEDS_APPROVAL);
      assert.equal(loaded.length, 1);
      assert.include(
        (yield* Effect.flip(trust.approve(path.join(directory, "x.ts"), "0"))).message,
        "not waiting",
      );

      // Saved in the editor: approved as a person's, once.
      yield* trust.record(directory, "flow.ts", v1, "user");
      yield* trust.record(directory, "flow.ts", v1, "user");
      assert.deepStrictEqual(yield* trust.pending, []);

      const kinds = (yield* audit.list({})).entries.map((entry) => entry.kind).toReversed();
      assert.deepStrictEqual(kinds, [
        "workflow.approved",
        "workflow.approval_revoked",
        "workflow.approved",
      ]);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("a held file stays held while it cannot be read for a moment", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const services = yield* Layer.build(
      WorkflowTrust.layer.pipe(Layer.provide(Layer.merge(Sqlite.layerMemory, NodeCrypto.layer))),
    );
    const trust = Context.get(services, WorkflowTrust.WorkflowTrust);
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-trust-" });
    const file = path.join(directory, "flow.ts");
    yield* fileSystem.writeFileString(file, "v1");
    yield* trust.gated(file, () => Effect.die("not approved"));

    // An atomic save: the file is gone until the new one is renamed into place.
    yield* fileSystem.rename(file, `${file}.saving`);
    assert.deepStrictEqual(yield* trust.pending, []);
    yield* fileSystem.rename(`${file}.saving`, file);

    const [shown] = yield* trust.pending;
    assert.equal(shown?.path, file);
    yield* trust.approve(shown!.path, shown!.sha256);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
