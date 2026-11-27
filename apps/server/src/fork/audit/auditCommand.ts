// Fork-only. `cmdeck audit verify`: checks this machine's audit chain, whether or not a server runs.
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { Command, GlobalFlag } from "effect/cli";

import { projectLocationFlags, resolveCliAuthConfig } from "../../cli/config.ts";
import * as AuditLog from "./AuditLog.ts";

class AuditVerifyFailedError extends Schema.TaggedError<AuditVerifyFailedError>()(
  "AuditVerifyFailedError",
  { detail: Schema.String },
) {
  // Printed once on stderr below; the runtime does not report it again.
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

const REASONS = {
  content_changed: "it was changed after it was written",
  chain_broken: "an entry before it was removed or inserted",
  start_unanchored: "entries before it were removed outside a prune",
} as const;

const verifyChain = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables =
    yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'`;
  if (tables.length === 0) return Option.none();
  return Option.some(yield* (yield* AuditLog.AuditLog).verify);
});

const verifyCommand = Command.make("verify", projectLocationFlags).pipe(
  Command.withDescription(
    "Check that no audit log entry was changed or removed since it was written. The log is tamper-evident, not tamper-proof: someone who can write the database can rebuild the whole chain.",
  ),
  Command.withHandler(
    Effect.fn("cli.audit.verify")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
        quietLogs: true,
      });
      const exists = yield* (yield* FileSystem.FileSystem)
        .exists(config.dbPath)
        .pipe(Effect.orElseSucceed(() => false));
      const result = exists
        ? yield* verifyChain.pipe(
            Effect.provide(
              AuditLog.layerService.pipe(
                // Read-only: no setup and no writes, so it is safe while a server runs.
                Layer.provideMerge(
                  NodeSqliteClient.layer({ filename: config.dbPath, readonly: true }),
                ),
              ),
            ),
          )
        : Option.none();
      if (Option.isNone(result)) {
        yield* Console.log("The audit log is empty.");
        return;
      }
      const { ok, checked, brokenSeq, reason } = result.value;
      if (ok) {
        yield* Console.log(`The audit log is intact: ${checked} entries checked.`);
        return;
      }
      const detail = `The audit log is broken at entry ${brokenSeq}: ${reason === null ? "unknown" : REASONS[reason]}. ${checked} earlier ${checked === 1 ? "entry is" : "entries are"} intact.`;
      yield* Console.error(detail);
      return yield* new AuditVerifyFailedError({ detail });
    }),
  ),
);

export const auditCommand = Command.make("audit").pipe(
  Command.withDescription(
    "Inspect the local audit log of approvals, pairings, tokens and secret reveals.",
  ),
  Command.withSubcommands([verifyCommand]),
);
