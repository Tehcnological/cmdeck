import {
  type MemoryBulkEditInput,
  type MemoryBulkEditResult,
  type MemoryInjection,
  MemoryItem,
  type MemoryKind,
  type MemoryListInput,
  type MemoryRevision,
  type MemoryScope,
  type ProjectId,
  repositoryGroupingKeyOf,
  stricterMemoryMode,
  type ThreadId,
  ThreadMemoryMode,
} from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { activeBotForThread } from "../bots/schema.ts";
import * as MemoryAccess from "./MemoryAccess.ts";
import * as MemoryEmbeddings from "./MemoryEmbeddings.ts";
import {
  CANDIDATE_MULTIPLIER,
  ftsQuery,
  type RankCandidate,
  rankByRelevance,
} from "./retrieval.ts";

export class MemoryStoreError extends Schema.TaggedError<MemoryStoreError>()("MemoryStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Memory could not ${this.operation}.`;
  }
}

export class MemoryAccessDeniedError extends Schema.TaggedError<MemoryAccessDeniedError>()(
  "MemoryAccessDeniedError",
  {
    access: Schema.Literals(["read", "write"]),
    mode: ThreadMemoryMode,
    scope: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    if (this.access === "write" && this.mode !== "persistent") {
      return `This thread's memory is ${this.mode}, so nothing it learns is saved.`;
    }
    if (this.access === "read" && this.mode === "temporary") {
      return "This thread's memory is temporary, so it reads no saved memory.";
    }
    return `This thread cannot use memory in scope ${this.scope ?? "(none)"}.`;
  }
}

export class MemoryItemNotFoundError extends Schema.TaggedError<MemoryItemNotFoundError>()(
  "MemoryItemNotFoundError",
  { itemId: Schema.String, revision: Schema.optional(Schema.Number) },
) {
  override get message(): string {
    return this.revision === undefined
      ? `No memory item ${this.itemId}.`
      : `Memory item ${this.itemId} has no revision ${this.revision}.`;
  }
}

/** A bulk edit names items that changed after they were shown, so it would not do what was previewed. */
export class MemorySelectionStaleError extends Schema.TaggedError<MemorySelectionStaleError>()(
  "MemorySelectionStaleError",
  { itemIds: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return "Some selected memories changed since they were shown. Refresh and select them again.";
  }
}

export type MemoryActor = "user" | "agent";

const LIST_LIMIT = 1_000;
const INJECTION_LIMIT = 200;
// A thread's parent chain is short; the cap only stops a corrupt cycle.
const LINEAGE_DEPTH_LIMIT = 16;

const sameItem = (left: MemoryItem, right: MemoryItem) =>
  (Object.keys(MemoryItem.fields) as ReadonlyArray<keyof MemoryItem>).every(
    (field) => left[field] === right[field],
  );

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const decodeItem = Schema.decodeUnknownSync(MemoryItem);
const decodeMode = Schema.decodeUnknownOption(ThreadMemoryMode);

interface ItemRow {
  readonly id: string;
  readonly scope: string;
  readonly kind: string;
  readonly content: string;
  readonly provenance: string;
  readonly status: string;
  readonly originThreadId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const toItem = (row: ItemRow): MemoryItem => decodeItem(row);

export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    /** The `cmdeck.memoryEnabled` setting; every agent-facing path checks it first. */
    readonly enabled: Effect.Effect<boolean>;
    readonly threadContext: (thread: {
      readonly id: ThreadId;
      readonly projectId: ProjectId;
    }) => Effect.Effect<MemoryAccess.MemoryThreadContext>;
    /** A thread that cannot be read gets the restricted context. */
    readonly resolveThread: (threadId: ThreadId) => Effect.Effect<MemoryAccess.MemoryThreadContext>;
    readonly setThreadMode: (
      threadId: ThreadId,
      mode: ThreadMemoryMode,
    ) => Effect.Effect<void, MemoryStoreError>;
    /**
     * A person's write is active. An agent's is active only during a turn a person started;
     * otherwise it waits as a pending proposal.
     */
    readonly remember: (input: {
      readonly context: MemoryAccess.MemoryThreadContext;
      readonly scope: MemoryScope;
      readonly kind: MemoryKind;
      readonly content: string;
      readonly actor: MemoryActor;
    }) => Effect.Effect<MemoryItem, MemoryAccessDeniedError | MemoryStoreError>;
    readonly search: (input: {
      readonly context: MemoryAccess.MemoryThreadContext;
      readonly query: string;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<MemoryItem>, MemoryAccessDeniedError | MemoryStoreError>;
    /** Active rules visible to the thread, then the facts that best match the text. */
    readonly forTurn: (input: {
      readonly context: MemoryAccess.MemoryThreadContext;
      readonly text: string;
      readonly factLimit: number;
    }) => Effect.Effect<
      { readonly rules: ReadonlyArray<MemoryItem>; readonly facts: ReadonlyArray<MemoryItem> },
      MemoryStoreError
    >;
    /** Retires an item the thread can write. Reversible with `revert`. */
    readonly forget: (input: {
      readonly context: MemoryAccess.MemoryThreadContext;
      readonly itemId: string;
    }) => Effect.Effect<
      MemoryItem,
      MemoryAccessDeniedError | MemoryItemNotFoundError | MemoryStoreError
    >;
    /** A person accepts a pending proposal; it is injected from the next turn on. */
    readonly accept: (
      itemId: string,
    ) => Effect.Effect<MemoryItem, MemoryItemNotFoundError | MemoryStoreError>;
    /** Puts an item back as it was after `revision`, as a new revision. */
    readonly revert: (input: {
      readonly itemId: string;
      readonly revision: number;
      readonly actor: MemoryActor;
    }) => Effect.Effect<MemoryItem, MemoryItemNotFoundError | MemoryStoreError>;
    readonly get: (itemId: string) => Effect.Effect<Option.Option<MemoryItem>, MemoryStoreError>;
    readonly revisions: (
      itemId: string,
    ) => Effect.Effect<ReadonlyArray<MemoryRevision>, MemoryStoreError>;
    /** Retires every live item in a scope (a deleted bot's memory); returns their ids. */
    readonly retireScope: (
      scope: MemoryScope,
    ) => Effect.Effect<ReadonlyArray<string>, MemoryStoreError>;
    /** Puts retired items back to the status they had before they were retired. */
    readonly restoreRetired: (
      itemIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, MemoryStoreError>;
    /** Items in one scope kind and status, newest change first. */
    readonly list: (
      input: MemoryListInput,
    ) => Effect.Effect<ReadonlyArray<MemoryItem>, MemoryStoreError>;
    /** A person's edit of content or kind. An unchanged edit writes no revision. */
    readonly edit: (input: {
      readonly itemId: string;
      readonly content?: string | undefined;
      readonly kind?: MemoryKind | undefined;
    }) => Effect.Effect<MemoryItem, MemoryItemNotFoundError | MemoryStoreError>;
    /**
     * A person's edit of many items at once. `apply: false` previews it and writes nothing;
     * applying the same input writes the previewed changes, one revision each, or nothing.
     */
    readonly bulkEdit: (
      input: MemoryBulkEditInput & { readonly apply: boolean },
    ) => Effect.Effect<
      MemoryBulkEditResult,
      MemoryItemNotFoundError | MemorySelectionStaleError | MemoryStoreError
    >;
    /** The thread's mode; a fork or subagent without its own takes a copy of its parent's. */
    readonly threadMode: (threadId: ThreadId) => Effect.Effect<ThreadMemoryMode, MemoryStoreError>;
    /** Makes the thread's memory at least as private as `mode`; only a person loosens it. */
    readonly restrictThreadMode: (
      threadId: ThreadId,
      mode: ThreadMemoryMode,
    ) => Effect.Effect<ThreadMemoryMode, MemoryStoreError>;
    /** What the thread's turns were given, newest first, as each item is now. */
    readonly injections: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<MemoryInjection>, MemoryStoreError>;
    readonly recordInjections: (input: {
      readonly threadId: ThreadId;
      readonly runId: string;
      readonly itemIds: ReadonlyArray<string>;
    }) => Effect.Effect<void, MemoryStoreError>;
  }
>()("t3/fork/memory/MemoryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const random = yield* SecureRandom.SecureRandom;
  // Optional: without it, or without an embedder configured, search is keyword-only.
  const embeddings = yield* Effect.serviceOption(MemoryEmbeddings.MemoryEmbeddings);

  const failsTo =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new MemoryStoreError({ operation, cause })));

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const selectItems = sql.literal(`SELECT id, scope, kind, content, provenance, status,
    origin_thread_id AS "originThreadId", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM memory_items`);

  const findItem = (itemId: string) =>
    sql<ItemRow>`${selectItems} WHERE id = ${itemId}`.pipe(
      Effect.map((rows) => Option.map(Option.fromUndefinedOr(rows[0]), toItem)),
    );

  const writeRevision = (before: MemoryItem | null, after: MemoryItem, actor: MemoryActor) =>
    sql`INSERT INTO memory_revisions (item_id, revision, actor, before_json, after_json, created_at)
      SELECT ${after.id}, COALESCE(MAX(revision), 0) + 1, ${actor},
        ${before === null ? null : JSON.stringify(before)}, ${JSON.stringify(after)}, ${after.updatedAt}
      FROM memory_revisions WHERE item_id = ${after.id}`;

  const saveItem = (before: MemoryItem, after: MemoryItem, actor: MemoryActor) =>
    sql
      .withTransaction(
        sql`UPDATE memory_items SET scope = ${after.scope}, kind = ${after.kind},
          content = ${after.content}, provenance = ${after.provenance}, status = ${after.status},
          updated_at = ${after.updatedAt}
          WHERE id = ${after.id}`.pipe(Effect.andThen(writeRevision(before, after, actor))),
      )
      .pipe(Effect.as(after));

  const requireItem = (itemId: string) =>
    findItem(itemId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new MemoryItemNotFoundError({ itemId })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const storedMode = (threadId: ThreadId) =>
    sql<{
      readonly mode: string;
    }>`SELECT mode FROM thread_memory_mode WHERE thread_id = ${threadId}`.pipe(
      Effect.map((rows) =>
        rows[0] === undefined
          ? Option.none<ThreadMemoryMode>()
          : // A mode this build cannot read is a boundary it cannot honour: the strictest one.
            Option.some(Option.getOrElse(decodeMode(rows[0].mode), () => "temporary" as const)),
      ),
    );

  // Ported from KiroCrew@b75544f0 src/kiro_crew/dashboard/chat_fork_memory_mode.py (Apache-2.0):
  // a fork is born with its parent's memory boundary. Kiro copies it when the fork is made;
  // here the copy is taken the first time the child's mode is read, before its first turn.
  const resolveMode: (
    threadId: ThreadId,
    depth: number,
  ) => Effect.Effect<ThreadMemoryMode, SqlError.SqlError | ProjectionStore.ProjectionStoreV2Error> =
    Effect.fn("MemoryStore.resolveMode")(function* (threadId, depth) {
      const stored = yield* storedMode(threadId);
      if (Option.isSome(stored)) return stored.value;
      const thread = yield* projections.findThread(threadId);
      const parentId = thread?.lineage.parentThreadId ?? null;
      if (parentId === null || depth >= LINEAGE_DEPTH_LIMIT) return "persistent";
      const inherited = yield* resolveMode(parentId, depth + 1);
      const at = yield* now;
      yield* sql`INSERT OR IGNORE INTO thread_memory_mode (thread_id, mode, updated_at)
      VALUES (${threadId}, ${inherited}, ${at})`;
      return inherited;
    });

  const threadMode = (threadId: ThreadId) => resolveMode(threadId, 0);

  const writeMode = Effect.fn("MemoryStore.writeMode")(function* (
    threadId: ThreadId,
    mode: ThreadMemoryMode,
  ) {
    const at = yield* now;
    yield* sql`INSERT INTO thread_memory_mode (thread_id, mode, updated_at)
        VALUES (${threadId}, ${mode}, ${at})
        ON CONFLICT (thread_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`;
  });

  const threadContext: MemoryStore["Service"]["threadContext"] = Effect.fn(
    "MemoryStore.threadContext",
  )(
    function* (thread) {
      const mode = yield* threadMode(thread.id);
      const project = yield* projects.getShell(thread.projectId);
      const identity = Option.getOrUndefined(project)?.repositoryIdentity;
      const bot = yield* activeBotForThread(sql, thread.id);
      return {
        threadId: thread.id,
        projectId: thread.projectId,
        repoKey: identity == null ? null : repositoryGroupingKeyOf(identity),
        botId: bot?.id ?? null,
        mode,
      } satisfies MemoryAccess.MemoryThreadContext;
    },
    (effect, thread) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Memory could not read the thread; it gets no memory.", cause).pipe(
            Effect.as(MemoryAccess.restrictedContext(thread.id)),
          ),
        ),
      ),
  );

  const resolveThread: MemoryStore["Service"]["resolveThread"] = Effect.fn(
    "MemoryStore.resolveThread",
  )(function* (threadId) {
    const thread = yield* projections.findThread(threadId).pipe(Effect.orElseSucceed(() => null));
    return thread === null
      ? MemoryAccess.restrictedContext(threadId)
      : yield* threadContext({ id: thread.id, projectId: thread.projectId });
  });

  const remember: MemoryStore["Service"]["remember"] = Effect.fn("MemoryStore.remember")(
    function* (input) {
      const { context } = input;
      if (!MemoryAccess.allows(context, "write", input.scope)) {
        return yield* new MemoryAccessDeniedError({
          access: "write",
          mode: context.mode,
          scope: input.scope,
        });
      }
      // An agent's write is a proposal even in a turn a person started: text it read in that
      // turn (a file, a web page) could otherwise plant a standing rule. A person accepts it.
      const asked = input.actor === "user";
      // Whitespace-only content trims to nothing, which would save an item that says nothing.
      const content = redactSecrets(input.content.trim());
      if (content === "") {
        return yield* new MemoryStoreError({
          operation: "save an empty item",
          cause: "the content is blank",
        });
      }
      const at = yield* now;
      const item: MemoryItem = {
        id: yield* random.uuidV4().pipe(failsTo("name the item")),
        scope: input.scope,
        kind: input.kind,
        // Saved memory reaches later provider prompts, so secrets never enter it.
        content,
        provenance: asked ? "user_explicit" : "agent_inferred",
        status: asked ? "active" : "pending",
        originThreadId: context.threadId,
        createdAt: at,
        updatedAt: at,
      };
      yield* sql
        .withTransaction(
          sql`INSERT INTO memory_items
            (id, scope, kind, content, provenance, status, origin_thread_id, created_at, updated_at)
            VALUES (${item.id}, ${item.scope}, ${item.kind}, ${item.content}, ${item.provenance},
              ${item.status}, ${item.originThreadId}, ${item.createdAt}, ${item.updatedAt})`.pipe(
            Effect.andThen(writeRevision(null, item, input.actor)),
          ),
        )
        .pipe(failsTo("save the item"));
      return item;
    },
  );

  const matchingActive = Effect.fn("MemoryStore.matchingActive")(function* (
    context: MemoryAccess.MemoryThreadContext,
    text: string,
    limit: number,
    kind?: MemoryKind,
  ) {
    const scopes = MemoryAccess.readableScopes(context);
    if (scopes.length === 0) return [];
    const candidates = limit * CANDIDATE_MULTIPLIER;
    const query = ftsQuery(text);
    const rows =
      query === null
        ? []
        : yield* sql<ItemRow & { readonly bm25: number }>`
        SELECT items.id, items.scope, items.kind, items.content, items.provenance, items.status,
          items.origin_thread_id AS "originThreadId", items.created_at AS "createdAt",
          items.updated_at AS "updatedAt", bm25(memory_fts) AS bm25
        FROM memory_fts INNER JOIN memory_items AS items ON items.seq = memory_fts.rowid
        WHERE memory_fts MATCH ${query}
          AND items.status = 'active'
          AND items.scope IN ${sql.in(scopes)}
          ${kind === undefined ? sql`` : sql`AND items.kind = ${kind}`}
        ORDER BY bm25 LIMIT ${candidates}
      `.pipe(
            Effect.catchTags({
              SqlError: (cause) =>
                Effect.logWarning("Memory search failed; using no matches.", cause).pipe(
                  Effect.as([]),
                ),
            }),
          );
    const vectors = Option.isNone(embeddings)
      ? Option.none()
      : yield* embeddings.value.match({
          text,
          scopes,
          limit: candidates,
          ...(kind === undefined ? {} : { kind }),
        });
    const matched = new Map<string, RankCandidate>(
      rows.map((row) => [row.id, { item: toItem(row), bm25: row.bm25 }]),
    );
    if (Option.isSome(vectors)) {
      const unseen = vectors.value.filter(({ itemId }) => !matched.has(itemId));
      const extra =
        unseen.length === 0
          ? []
          : yield* sql<ItemRow>`${selectItems}
              WHERE status = 'active' AND id IN ${sql.in(unseen.map(({ itemId }) => itemId))}`;
      for (const row of extra) matched.set(row.id, { item: toItem(row) });
      for (const { itemId, cosine } of vectors.value) {
        const candidate = matched.get(itemId);
        if (candidate !== undefined) matched.set(itemId, { ...candidate, cosine });
      }
    }
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    return rankByRelevance([...matched.values()], nowMs, Option.isSome(vectors)).slice(0, limit);
  });

  const search: MemoryStore["Service"]["search"] = Effect.fn("MemoryStore.search")(
    function* (input) {
      if (!MemoryAccess.allows(input.context, "read")) {
        return yield* new MemoryAccessDeniedError({ access: "read", mode: input.context.mode });
      }
      return yield* matchingActive(input.context, input.query, input.limit).pipe(failsTo("search"));
    },
  );

  const forTurn: MemoryStore["Service"]["forTurn"] = Effect.fn("MemoryStore.forTurn")(function* (
    input,
  ) {
    const scopes = MemoryAccess.readableScopes(input.context);
    if (scopes.length === 0) return { rules: [], facts: [] };
    const rules = yield* sql<ItemRow>`${selectItems}
        WHERE status = 'active' AND kind = 'rule' AND scope IN ${sql.in(scopes)}
        ORDER BY created_at ASC`.pipe(Effect.map((rows) => rows.map(toItem)));
    const facts = yield* matchingActive(input.context, input.text, input.factLimit, "fact");
    return { rules, facts };
  }, failsTo("read memory for the turn"));

  const forget: MemoryStore["Service"]["forget"] = Effect.fn("MemoryStore.forget")(
    function* (input) {
      const before = yield* requireItem(input.itemId).pipe(
        Effect.catchTags({
          SqlError: (cause) =>
            Effect.fail(new MemoryStoreError({ operation: "read the item", cause })),
        }),
      );
      if (!MemoryAccess.allows(input.context, "write", before.scope)) {
        // An item the thread cannot see answers as missing, so its existence does not leak.
        return yield* MemoryAccess.allows(input.context, "read", before.scope)
          ? new MemoryAccessDeniedError({
              access: "write",
              mode: input.context.mode,
              scope: before.scope,
            })
          : new MemoryItemNotFoundError({ itemId: input.itemId });
      }
      if (before.status === "retired") return before;
      return yield* saveItem(
        before,
        { ...before, status: "retired", updatedAt: yield* now },
        "agent",
      ).pipe(failsTo("retire the item"));
    },
  );

  const accept: MemoryStore["Service"]["accept"] = Effect.fn("MemoryStore.accept")(
    function* (itemId) {
      const before = yield* requireItem(itemId).pipe(
        Effect.catchTags({
          SqlError: (cause) =>
            Effect.fail(new MemoryStoreError({ operation: "read the item", cause })),
        }),
      );
      if (before.status !== "pending") return before;
      return yield* saveItem(
        before,
        { ...before, status: "active", provenance: "user_confirmed", updatedAt: yield* now },
        "user",
      ).pipe(failsTo("accept the item"));
    },
  );

  const revisions: MemoryStore["Service"]["revisions"] = Effect.fn("MemoryStore.revisions")(
    function* (itemId) {
      const rows = yield* sql<{
        readonly revision: number;
        readonly actor: "user" | "agent";
        readonly beforeJson: string | null;
        readonly afterJson: string;
        readonly createdAt: string;
      }>`SELECT revision, actor, before_json AS "beforeJson", after_json AS "afterJson",
          created_at AS "createdAt"
        FROM memory_revisions WHERE item_id = ${itemId} ORDER BY revision ASC`;
      return rows.map((row): MemoryRevision => ({
        itemId,
        revision: row.revision,
        actor: row.actor,
        before: row.beforeJson === null ? null : decodeItem(JSON.parse(row.beforeJson)),
        after: decodeItem(JSON.parse(row.afterJson)),
        createdAt: row.createdAt,
      }));
    },
    failsTo("read revisions"),
  );

  const revert: MemoryStore["Service"]["revert"] = Effect.fn("MemoryStore.revert")(
    function* (input) {
      const history = yield* revisions(input.itemId);
      const target = history.find((entry) => entry.revision === input.revision);
      const before = yield* findItem(input.itemId).pipe(failsTo("read the item"));
      if (target === undefined || Option.isNone(before)) {
        return yield* new MemoryItemNotFoundError({
          itemId: input.itemId,
          revision: input.revision,
        });
      }
      return yield* saveItem(
        before.value,
        { ...target.after, updatedAt: yield* now },
        input.actor,
      ).pipe(failsTo("revert the item"));
    },
  );

  const retireScope: MemoryStore["Service"]["retireScope"] = Effect.fn("MemoryStore.retireScope")(
    function* (scope) {
      const live = yield* sql<ItemRow>`${selectItems}
        WHERE scope = ${scope} AND status IN ('active', 'pending')`;
      const at = yield* now;
      for (const row of live) {
        const before = toItem(row);
        yield* saveItem(before, { ...before, status: "retired", updatedAt: at }, "user");
      }
      return live.map((row) => row.id);
    },
    failsTo("retire the scope"),
  );

  const restoreRetired: MemoryStore["Service"]["restoreRetired"] = Effect.fn(
    "MemoryStore.restoreRetired",
  )(function* (itemIds) {
    for (const itemId of itemIds) {
      const current = Option.getOrUndefined(yield* findItem(itemId));
      if (current?.status !== "retired") continue;
      const history = yield* revisions(itemId);
      const status = history.findLast((entry) => entry.after.status === "retired")?.before?.status;
      if (status === undefined || status === "retired") continue;
      yield* saveItem(current, { ...current, status, updatedAt: yield* now }, "user");
    }
  }, failsTo("restore the items"));

  const list: MemoryStore["Service"]["list"] = Effect.fn("MemoryStore.list")(function* (input) {
    const rows = yield* sql<ItemRow>`${selectItems}
        WHERE 1 = 1
          ${input.scopeKind === undefined ? sql`` : input.scopeKind === "global" ? sql`AND scope = 'global'` : sql`AND scope LIKE ${`${input.scopeKind}:%`}`}
          ${input.status === undefined ? sql`` : sql`AND status = ${input.status}`}
        ORDER BY updated_at DESC, seq DESC LIMIT ${LIST_LIMIT}`;
    return rows.map(toItem);
  }, failsTo("list items"));

  const cleanContent = Effect.fn("MemoryStore.cleanContent")(function* (content: string) {
    // Saved memory reaches later provider prompts, so secrets never enter it.
    const cleaned = redactSecrets(content.trim());
    if (cleaned === "") {
      return yield* new MemoryStoreError({
        operation: "save an empty item",
        cause: "the content is blank",
      });
    }
    return cleaned;
  });

  const edit: MemoryStore["Service"]["edit"] = Effect.fn("MemoryStore.edit")(function* (input) {
    const before = yield* requireItem(input.itemId).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.fail(new MemoryStoreError({ operation: "read the item", cause })),
      }),
    );
    const content =
      input.content === undefined ? before.content : yield* cleanContent(input.content);
    const kind = input.kind ?? before.kind;
    if (content === before.content && kind === before.kind) return before;
    return yield* saveItem(
      before,
      { ...before, content, kind, updatedAt: yield* now },
      "user",
    ).pipe(failsTo("edit the item"));
  });

  // The status an item had before it was last retired, so restoring a rejected proposal
  // brings it back as a proposal, not as an accepted item.
  const statusBeforeRetiring = Effect.fn("MemoryStore.statusBeforeRetiring")(function* (
    item: MemoryItem,
  ) {
    const history = yield* revisions(item.id);
    const retiring = history.findLast(
      (entry) => entry.after.status === "retired" && entry.before !== null,
    );
    const previous = retiring?.before?.status;
    if (previous !== undefined && previous !== "retired") return previous;
    return item.provenance === "user_explicit" || item.provenance === "user_confirmed"
      ? ("active" as const)
      : ("pending" as const);
  });

  // Ported from KiroCrew@b75544f0 src/kiro_crew/memory_edit.py `_after` and `_replace`
  // (Apache-2.0); changed to this store's items, statuses and operations.
  const planChange = Effect.fn("MemoryStore.planChange")(function* (
    before: MemoryItem,
    operation: MemoryBulkEditInput["operation"],
    at: string,
  ) {
    switch (operation.type) {
      case "accept":
        return before.status === "pending"
          ? ({ ...before, status: "active", provenance: "user_confirmed", updatedAt: at } as const)
          : null;
      case "retire":
        return before.status === "retired"
          ? null
          : ({ ...before, status: "retired", updatedAt: at } as const);
      case "restore":
        return before.status === "retired"
          ? { ...before, status: yield* statusBeforeRetiring(before), updatedAt: at }
          : null;
      case "replace_text": {
        const pattern = new RegExp(
          escapeRegExp(operation.find),
          operation.matchCase ? "gu" : "giu",
        );
        const replaced = before.content.replace(pattern, () => operation.replacement);
        if (replaced === before.content) return null;
        const content = yield* cleanContent(replaced);
        return content === before.content ? null : { ...before, content, updatedAt: at };
      }
    }
  });

  const bulkEdit: MemoryStore["Service"]["bulkEdit"] = Effect.fn("MemoryStore.bulkEdit")(
    function* (input) {
      const plan = Effect.gen(function* () {
        const at = yield* now;
        const stale: Array<string> = [];
        const changes: Array<{ readonly before: MemoryItem; readonly after: MemoryItem }> = [];
        for (const shown of input.items) {
          const before = yield* findItem(shown.id).pipe(failsTo("read the item"));
          if (Option.isNone(before)) {
            return yield* new MemoryItemNotFoundError({ itemId: shown.id });
          }
          if (!sameItem(before.value, shown)) {
            stale.push(shown.id);
            continue;
          }
          const after = yield* planChange(before.value, input.operation, at);
          if (after !== null) changes.push({ before: before.value, after });
        }
        if (stale.length > 0) return yield* new MemorySelectionStaleError({ itemIds: stale });
        if (input.apply) {
          for (const change of changes) {
            yield* saveItem(change.before, change.after, "user").pipe(failsTo("save the edit"));
          }
        }
        return { matchedCount: input.items.length, changes };
      });
      // Applying re-reads every item inside the write, so nothing changes between check and save.
      return yield* input.apply
        ? sql.withTransaction(plan).pipe(
            Effect.catchTags({
              SqlError: (cause) =>
                Effect.fail(new MemoryStoreError({ operation: "save the edit", cause })),
            }),
          )
        : plan;
    },
  );

  const injections: MemoryStore["Service"]["injections"] = Effect.fn("MemoryStore.injections")(
    function* (threadId) {
      const rows = yield* sql<ItemRow & { readonly runId: string; readonly injectedAt: string }>`
        SELECT injections.run_id AS "runId", injections.injected_at AS "injectedAt",
          items.id, items.scope, items.kind, items.content, items.provenance, items.status,
          items.origin_thread_id AS "originThreadId", items.created_at AS "createdAt",
          items.updated_at AS "updatedAt"
        FROM memory_injections AS injections
          INNER JOIN memory_items AS items ON items.id = injections.item_id
        WHERE injections.thread_id = ${threadId}
        ORDER BY injections.injected_at DESC, items.seq ASC LIMIT ${INJECTION_LIMIT}`;
      return rows.map(({ runId, injectedAt, ...item }) => ({
        runId,
        injectedAt,
        item: toItem(item),
      }));
    },
    failsTo("read what the thread was given"),
  );

  return MemoryStore.of({
    enabled: settings.getSettings.pipe(
      Effect.map((current) => current.cmdeck.memoryEnabled),
      Effect.orElseSucceed(() => false),
    ),
    threadContext,
    resolveThread,
    setThreadMode: Effect.fn("MemoryStore.setThreadMode")(
      (threadId, mode) => writeMode(threadId, mode),
      failsTo("set the thread's memory mode"),
    ),
    remember,
    search,
    forTurn,
    forget,
    accept,
    revert,
    get: Effect.fn("MemoryStore.get")((itemId) => findItem(itemId), failsTo("read the item")),
    revisions,
    retireScope,
    restoreRetired,
    list,
    edit,
    bulkEdit,
    threadMode: Effect.fn("MemoryStore.threadMode")(
      (threadId) => threadMode(threadId),
      failsTo("read the thread's memory mode"),
    ),
    restrictThreadMode: Effect.fn("MemoryStore.restrictThreadMode")(function* (threadId, mode) {
      const current = yield* threadMode(threadId);
      const next = stricterMemoryMode(current, mode);
      if (next !== current) yield* writeMode(threadId, next);
      return next;
    }, failsTo("set the thread's memory mode")),
    injections,
    recordInjections: Effect.fn("MemoryStore.recordInjections")(function* (input) {
      const at = yield* now;
      for (const itemId of input.itemIds) {
        yield* sql`INSERT OR IGNORE INTO memory_injections (run_id, item_id, thread_id, injected_at)
            VALUES (${input.runId}, ${itemId}, ${input.threadId}, ${at})`;
      }
    }, failsTo("record what was injected")),
  });
});

export const layer = Layer.effect(MemoryStore, make);
