// @effect-diagnostics nodeBuiltinImport:off -- Checks the temp data folders the import reads and writes.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeCli } from "../../binCli.ts";
import * as T3Import from "../T3Import.ts";
import { makeSource } from "../T3Import.testkit.ts";
import * as Importer from "./Importer.ts";

const tempRoot = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "t3-importer-" }));
});

const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const before = (yield* TestConsole.logLines).length;
    yield* Command.runWith(makeCli(), { version: "0.0.0" })(args);
    return (yield* TestConsole.logLines).slice(before).join("\n");
  });

it.layer(
  Layer.mergeAll(Importer.layer, T3Import.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer)),
  ),
)("Importer", (it) => {
  it.effect("names the available sources when asked for an unknown one", () =>
    Effect.gen(function* () {
      const importer = yield* Importer.Importer;
      assert.deepEqual(importer.names, ["t3", "snapshot"]);
      const failure = yield* Effect.flip(importer.source("kiro"));
      assert.equal(failure._tag, "UnknownImportSourceError");
      assert.include(failure.message, '"kiro"');
      assert.include(failure.message, "Available: t3, snapshot.");
      // Inherited object keys are not sources.
      assert.equal((yield* Effect.flip(importer.source("constructor")))._tag, failure._tag);
    }),
  );

  it.effect("the t3 source is T3Import, reading the folder --source names", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const source = NodePath.join(root, "t3");
      const target = NodePath.join(root, "cmdeck");
      makeSource(source).close();
      const t3 = yield* (yield* Importer.Importer).source("t3");

      const locations = yield* Importer.resolveImportLocations({
        source: t3,
        from: NodePath.join(source, "userdata"),
        baseDir: target,
      });
      assert.deepEqual(locations, { source, target });
      const direct = (yield* T3Import.T3Import).plan(locations);
      yield* direct; // leaves SQLite's empty -wal and -shm files, which later plans list
      assert.deepEqual(yield* t3.plan(locations), yield* direct);
    }),
  );

  it.effect(
    "`import t3 --plan` prints what `import-from-t3 --dry-run` did and writes nothing",
    () =>
      Effect.gen(function* () {
        const root = yield* tempRoot;
        const source = NodePath.join(root, "t3");
        const target = NodePath.join(root, "cmdeck");
        makeSource(source).close();
        const folders = ["--base-dir", target];
        yield* (yield* T3Import.T3Import).plan({ source, target }); // leaves the helper files, as above

        const planned = yield* runCli(["import", "t3", "--plan", "--source", source, ...folders]);
        const legacy = yield* runCli(["import-from-t3", "--dry-run", "--from", source, ...folders]);

        assert.include(planned, `From: ${source}`);
        assert.include(planned, "userdata/statev2.sqlite");
        assert.include(planned, "Dry run: nothing was changed.");
        assert.equal(planned, legacy);
        assert.isFalse(NodeFS.existsSync(target));
      }).pipe(Effect.scoped),
  );

  it.effect("`import` with an unknown source lists the available ones", () =>
    Effect.gen(function* () {
      const root = yield* tempRoot;
      const failure = yield* Effect.flip(
        runCli(["import", "kiro", "--plan", "--base-dir", NodePath.join(root, "cmdeck")]),
      );
      assert.include(String(failure), "Available: t3, snapshot.");
    }).pipe(Effect.scoped),
  );
});
