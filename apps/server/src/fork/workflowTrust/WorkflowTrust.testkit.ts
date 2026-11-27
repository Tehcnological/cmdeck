import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { ensureAuditSchema } from "../audit/schema.ts";
import { ensureWorkflowTrustSchema } from "./schema.ts";
import { WorkflowTrust, layer } from "./WorkflowTrust.ts";

/** Trusts every file, for runtime tests about something other than the gate. */
const trustingAll = WorkflowTrust.of({
  gated: (file, _source, load) => load(file),
  pending: Effect.succeed([]),
  approve: () => Effect.void,
  record: () => Effect.void,
  approvals: Stream.empty,
});

/** The real gate over `database` when `gated`, for as long as the calling scope; else `trustingAll`. */
export const make = Effect.fn("WorkflowTrustTestkit.make")(function* <E>(
  gated: boolean,
  database: Layer.Layer<SqlClient.SqlClient, E>,
) {
  if (!gated) return trustingAll;
  yield* Effect.provide(Effect.andThen(ensureAuditSchema(), ensureWorkflowTrustSchema()), database);
  const built = yield* Layer.build(
    layer.pipe(Layer.provide(Layer.merge(database, NodeCrypto.layer))),
  );
  return Context.get(built, WorkflowTrust);
});
