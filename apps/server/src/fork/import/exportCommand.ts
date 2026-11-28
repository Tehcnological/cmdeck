// Fork-only. `cmdeck export snapshot`: safe while CMDeck runs, since it copies a consistent snapshot.
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";

import { baseDirFlag } from "../../cli/config.ts";
import * as ServerConfig from "../../config.ts";
import * as Importer from "./Importer.ts";
import * as Snapshot from "./Snapshot.ts";

const outFlag = Flag.String("out").pipe(
  Flag.withDescription(
    "A new or empty folder to write the snapshot to. Default: snapshots/snapshot-<time> in the data folder.",
  ),
  Flag.optional,
);

const snapshotCommand = Command.make("snapshot", { out: outFlag, baseDir: baseDirFlag }).pipe(
  Command.withDescription(
    "Write threads, projects, memory, bots and settings to a folder that `cmdeck import snapshot --source <folder>` restores. Secrets, sign-ins and worktrees are left out, and credential-like text is redacted.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* Importer.resolveHome(Option.getOrUndefined(flags.baseDir));
      const { stateDir } = yield* ServerConfig.deriveServerPaths(home, undefined);
      const out = Option.getOrUndefined(flags.out);
      const result = yield* (yield* Snapshot.Snapshot).export({
        stateDir,
        out: out === undefined ? undefined : path.resolve(out),
      });
      yield* Console.log(
        [
          `Snapshot written to ${result.path}.`,
          `Database schema ${result.manifest.schema}; CMDeck ${result.manifest.appVersion}.`,
          "",
          "Not included:",
          ...result.manifest.notIncluded.map((line) => `  - ${line}`),
        ].join("\n"),
      );
    }).pipe(Effect.provide(Snapshot.layer)),
  ),
);

export const exportCommand = Command.make("export").pipe(
  Command.withDescription("Export CMDeck data. Subcommands: snapshot."),
  Command.withSubcommands([snapshotCommand]),
);
