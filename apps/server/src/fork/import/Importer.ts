// Fork-only. The sources `cmdeck import <source>` reads; each plans before it writes anything.
import { APP_HOME_ENV, UPSTREAM_HOME_ENV } from "@t3tools/shared/appIdentity";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath, resolveBaseDir } from "../../os-jank.ts";
import * as T3Import from "../T3Import.ts";

export interface ImportLocations {
  /** The folder the source reads, never written to. */
  readonly source: string;
  /** This build's data folder. */
  readonly target: string;
}

export interface ImportSource {
  /** The folder to read: `dir` is what `--source` named (absolute), or undefined for the default. */
  readonly locate: (dir: string | undefined) => Effect.Effect<string>;
  readonly plan: (
    input: ImportLocations,
  ) => Effect.Effect<T3Import.ImportPlan, T3Import.T3ImportError>;
  /** Moves the target's existing data to a timestamped backup first when `force` is set. */
  readonly run: (
    input: ImportLocations & { readonly force: boolean },
  ) => Effect.Effect<T3Import.ImportResult, T3Import.T3ImportError>;
}

export class UnknownImportSourceError extends Schema.TaggedError<UnknownImportSourceError>()(
  "UnknownImportSourceError",
  { requested: Schema.String, available: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `There is no import source named "${this.requested}". Available: ${this.available.join(", ")}.`;
  }
}

export class Importer extends Context.Service<
  Importer,
  {
    readonly names: ReadonlyArray<string>;
    readonly source: (name: string) => Effect.Effect<ImportSource, UnknownImportSourceError>;
  }
>()("t3/fork/import/Importer") {}

const makeImporter = (sources: Readonly<Record<string, ImportSource>>) => {
  const names = Object.keys(sources);
  return Importer.of({
    names,
    source: Effect.fn("Importer.source")(function* (name) {
      const found = Object.hasOwn(sources, name) ? sources[name] : undefined;
      if (found === undefined) {
        return yield* new UnknownImportSourceError({ requested: name, available: names });
      }
      return found;
    }),
  });
};

const make = Effect.gen(function* () {
  const t3 = yield* T3Import.T3Import;
  const path = yield* Path.Path;
  return makeImporter({
    t3: {
      locate: (dir) => T3Import.locateSource(dir).pipe(Effect.provideService(Path.Path, path)),
      plan: t3.plan,
      run: t3.run,
    },
  });
});

export const layer = Layer.effect(Importer, make).pipe(Layer.provide(T3Import.layer));

/** Where an import reads from and writes to; the target is this build's base dir unless named. */
export const resolveImportLocations = Effect.fn("Importer.resolveImportLocations")(
  function* (input: {
    readonly source: ImportSource;
    readonly from: string | undefined;
    readonly baseDir: string | undefined;
  }) {
    const path = yield* Path.Path;
    const envHome = yield* Config.String(APP_HOME_ENV).pipe(
      Config.orElse(() => Config.String(UPSTREAM_HOME_ENV)),
      Config.option,
    );
    const target = yield* resolveBaseDir(input.baseDir ?? Option.getOrUndefined(envHome));
    const from =
      input.from === undefined ? undefined : path.resolve(yield* expandHomePath(input.from.trim()));
    return { source: yield* input.source.locate(from), target };
  },
);
