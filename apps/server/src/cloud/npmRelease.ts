import type {
  ServerNpmRelease,
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

// Private fork: published `t3` releases are upstream builds, so clients are never offered one to
// install over this fork, and the npm registry is never asked. Upstream arrives through
// scripts/fork/sync-upstream.sh and a rebuild.
export const layer = Layer.succeed(
  NpmRelease,
  NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* () {
      return null;
    }),
  }),
);
