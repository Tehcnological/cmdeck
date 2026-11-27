import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  type MilestoneEvent,
  MilestoneId,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../../config.ts";
import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as AuditLog from "./AuditLog.ts";

// The in-memory database runs every migration, so this also proves ForkSchema creates the table.
const layer = AuditLog.layerService.pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(NodeCrypto.layer),
);

const appendThree = Effect.gen(function* () {
  const audit = yield* AuditLog.AuditLog;
  yield* audit.append({ kind: "mcp_token.created", subject: "t1", detail: { label: "laptop" } });
  yield* audit.append({ kind: "device.pairing_approved", subject: "link-1" });
  yield* audit.append({ kind: "mcp_token.revoked", subject: "t1" });
  return audit;
});

it.effect("appends a verifiable chain and lists it newest first", () =>
  Effect.gen(function* () {
    const audit = yield* appendThree;
    expect(yield* audit.verify).toEqual({ ok: true, checked: 3, brokenSeq: null, reason: null });
    const page = yield* audit.list({ limit: 2 });
    expect(page.entries.map((entry) => entry.seq)).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    const rest = yield* audit.list({ beforeSeq: 2 });
    expect(rest.entries.map((entry) => [entry.seq, entry.kind, entry.detail])).toEqual([
      [1, "mcp_token.created", { label: "laptop" }],
    ]);
    expect(rest.hasMore).toBe(false);
  }).pipe(Effect.provide(layer)),
);

it.effect("stores no secret values", () =>
  Effect.gen(function* () {
    const audit = yield* AuditLog.AuditLog;
    const token = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
    yield* audit.append({
      kind: "mcp_token.created",
      actor: `user ${token}`,
      subject: `Bearer ${token}`,
      detail: { label: `key ${token}` },
    });
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<Record<string, unknown>>`SELECT * FROM audit_events`;
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(yield* audit.verify).toMatchObject({ ok: true });
  }).pipe(Effect.provide(layer)),
);

it.effect("reports the first entry that was edited, removed or cut from the start", () =>
  Effect.gen(function* () {
    const audit = yield* appendThree;
    const sql = yield* SqlClient.SqlClient;

    yield* sql`UPDATE audit_events SET detail_json = '{"label":"phone"}' WHERE seq = 1`;
    expect(yield* audit.verify).toEqual({
      ok: false,
      checked: 0,
      brokenSeq: 1,
      reason: "content_changed",
    });
    yield* sql`UPDATE audit_events SET detail_json = '{"label":"laptop"}' WHERE seq = 1`;
    expect(yield* audit.verify).toMatchObject({ ok: true });

    yield* sql`DELETE FROM audit_events WHERE seq = 2`;
    expect(yield* audit.verify).toEqual({
      ok: false,
      checked: 1,
      brokenSeq: 3,
      reason: "chain_broken",
    });

    yield* sql`DELETE FROM audit_events WHERE seq = 1`;
    expect(yield* audit.verify).toEqual({
      ok: false,
      checked: 0,
      brokenSeq: 3,
      reason: "start_unanchored",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("pruning past retention keeps the chain verifiable", () =>
  Effect.gen(function* () {
    const audit = yield* appendThree;
    expect(yield* audit.prune).toBe(0);

    yield* TestClock.adjust(AuditLog.RETENTION_MS + 1);
    yield* audit.append({ kind: "mcp_token.used", subject: "t2" });
    expect(yield* audit.prune).toBe(3);
    const [pruned, kept] = (yield* audit.list({})).entries;
    expect(pruned).toMatchObject({ seq: 5, kind: AuditLog.PRUNED_KIND });
    expect(pruned?.detail).toMatchObject({ throughSeq: 3, removed: 3 });
    expect(kept?.seq).toBe(4);
    expect(yield* audit.verify).toEqual({ ok: true, checked: 2, brokenSeq: null, reason: null });

    // A second prune removes the first prune's own entry and anchors on the new one.
    yield* TestClock.adjust(AuditLog.RETENTION_MS + 1);
    expect(yield* audit.prune).toBe(2);
    expect(yield* audit.verify).toEqual({ ok: true, checked: 1, brokenSeq: null, reason: null });

    // Forging the anchor still breaks the chain: the prune entry's own hash covers it.
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE audit_events SET detail_json = replace(detail_json, '"throughSeq":5', '"throughSeq":4')`;
    expect(yield* audit.verify).toMatchObject({ ok: false, brokenSeq: 6 });
  }).pipe(Effect.provide(layer)),
);

const fakeLog = (onAppend: (event: AuditLog.AuditEventInput) => Effect.Effect<void>) =>
  AuditLog.AuditLog.of({
    append: onAppend,
    list: () => Effect.die("unused"),
    verify: Effect.die("unused"),
    prune: Effect.succeed(0),
  });

it.effect("note does nothing without the log and appends through it when present", () =>
  Effect.gen(function* () {
    const appended: Array<AuditLog.AuditEventInput> = [];
    yield* AuditLog.notePairingApproved("link-1");
    yield* AuditLog.noteSecretReveal("file", "thread-1").pipe(
      Effect.provideService(
        AuditLog.AuditLog,
        fakeLog((event) => Effect.sync(() => void appended.push(event))),
      ),
    );
    expect(appended).toEqual([
      { kind: "secret.revealed", subject: "thread-1", detail: { via: "file" } },
    ]);
  }),
);

it.effect("records approval resolutions from the milestone feed", () =>
  Effect.gen(function* () {
    const appended = yield* Queue.unbounded<AuditLog.AuditEventInput>();
    const log = Layer.succeed(
      AuditLog.AuditLog,
      fakeLog((event) => Queue.offer(appended, event).pipe(Effect.asVoid)),
    );
    const layerUnderTest = AuditLog.layerSources.pipe(
      Layer.provideMerge(Layer.merge(log, MilestoneHub.layer)),
    );
    yield* Effect.gen(function* () {
      const hub = yield* MilestoneHub.MilestoneHub;
      const resolved = (kind: "approval" | "user_input", id: string): MilestoneEvent => ({
        id: MilestoneId.make(`thread.input_resolved:${id}`),
        occurredAt: "2026-11-26T00:00:00.000Z",
        projectId: ProjectId.make("project-1"),
        threadId: ThreadId.make("thread-1"),
        parentThreadId: null,
        actor: { type: "user" },
        isSubagentChild: false,
        type: "thread.input_resolved",
        requestId: RuntimeRequestId.make(id),
        kind,
        resolution: "resolved",
      });
      yield* hub.publish(resolved("user_input", "question-1"));
      yield* hub.publish(resolved("approval", "approval-1"));
      expect(yield* Queue.take(appended)).toEqual({
        kind: "approval.resolved",
        actor: "user",
        subject: "thread-1",
        detail: { requestId: "approval-1", resolution: "resolved", projectId: "project-1" },
      });
      expect(yield* Queue.size(appended)).toBe(0);
    }).pipe(Effect.provide(layerUnderTest));
  }),
);

it.effect("the importer's entry starts a verifiable chain in the imported database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dbPath = path.join(yield* fs.makeTempDirectoryScoped({ prefix: "audit-" }), "db.sqlite");
    yield* AuditLog.appendToDatabase(dbPath, { kind: "import.run", actor: "cli", subject: "t3" });
    yield* AuditLog.appendToDatabase(dbPath, { kind: "import.run", actor: "cli", subject: "t3" });
    const verified = yield* Effect.gen(function* () {
      return yield* (yield* AuditLog.AuditLog).verify;
    }).pipe(
      Effect.provide(
        AuditLog.layerService.pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: dbPath, readonly: true })),
        ),
      ),
    );
    expect(verified).toEqual({ ok: true, checked: 2, brokenSeq: null, reason: null });
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("a CLI command records in an existing database and creates none that is missing", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "audit-cli-" });
    const missing = path.join(dir, "missing.sqlite");
    yield* AuditLog.note({ kind: "mcp_token.created", subject: "t1" }).pipe(
      Effect.provide(AuditLog.layerAtDatabase(missing)),
    );
    expect(yield* fs.exists(missing)).toBe(false);

    const dbPath = path.join(dir, "db.sqlite");
    yield* AuditLog.appendToDatabase(dbPath, { kind: "import.run", actor: "cli", subject: "t3" });
    yield* AuditLog.note({ kind: "mcp_token.revoked", subject: "t1" }).pipe(
      Effect.provide(AuditLog.layerAtDatabase(dbPath)),
    );
    // A pairing approved without a server: only an approval that happened is recorded.
    for (const approved of [false, true]) {
      yield* AuditLog.notePairingApprovedLocally("link-9")(approved).pipe(
        Effect.provideService(ServerConfig.ServerConfig, { dbPath } as never),
      );
    }
    const { entries } = yield* Effect.gen(function* () {
      return yield* (yield* AuditLog.AuditLog).list({});
    }).pipe(
      Effect.provide(
        AuditLog.layerService.pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: dbPath, readonly: true })),
        ),
      ),
    );
    expect(entries.map((entry) => [entry.kind, entry.actor])).toEqual([
      ["device.pairing_approved", "cli"],
      ["mcp_token.revoked", null],
      ["import.run", "cli"],
    ]);
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
);
