import { describe, expect, it } from "@effect/vitest";
import { type MemoryItem, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import type * as MemoryAccess from "./MemoryAccess.ts";
import * as MemoryStore from "./MemoryStore.ts";
import { layerMemoryTest, threads } from "./memory.testkit.ts";

const contentsForTurn = Effect.fn("contentsForTurn")(function* (
  thread: (typeof threads)[keyof typeof threads],
  text = "anything",
) {
  const store = yield* MemoryStore.MemoryStore;
  const context = yield* store.threadContext(thread);
  const { rules, facts } = yield* store.forTurn({ context, text, factLimit: 8 });
  return [...rules, ...facts].map((item) => item.content);
});

describe("MemoryStore", () => {
  it.layer(layerMemoryTest({ memoryEnabled: true }))((it) => {
    it.effect("incognito refuses writes and allows reads", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const writer = yield* store.threadContext(threads.main);
        yield* store.remember({
          context: writer,
          scope: "project:project-app",
          kind: "fact",
          content: "The staging database is called incognito-staging",
          actor: "user",
        });
        yield* store.setThreadMode(threads.worktree.id, "incognito");
        const incognito = yield* store.threadContext(threads.worktree);

        const refused = yield* store
          .remember({
            context: incognito,
            scope: "project:project-app",
            kind: "fact",
            content: "Never saved",
            actor: "user",
          })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(MemoryStore.MemoryAccessDeniedError);
        const found = yield* store.search({ context: incognito, query: "staging", limit: 5 });
        expect(found.map((item) => item.content)).toEqual([
          "The staging database is called incognito-staging",
        ]);
      }),
    );

    it.effect("temporary refuses reads and writes and gives the turn nothing", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        yield* store.remember({
          context: yield* store.threadContext(threads.other),
          scope: "global",
          kind: "rule",
          content: "Answer in British English",
          actor: "user",
        });
        yield* store.setThreadMode(threads.other.id, "temporary");
        const temporary = yield* store.threadContext(threads.other);

        expect(
          yield* store.search({ context: temporary, query: "English", limit: 5 }).pipe(Effect.flip),
        ).toBeInstanceOf(MemoryStore.MemoryAccessDeniedError);
        expect(
          yield* store
            .remember({
              context: temporary,
              scope: "global",
              kind: "fact",
              content: "Never saved",
              actor: "user",
            })
            .pipe(Effect.flip),
        ).toBeInstanceOf(MemoryStore.MemoryAccessDeniedError);
        expect(yield* contentsForTurn(threads.other)).toEqual([]);
        yield* store.setThreadMode(threads.other.id, "persistent");
        expect(yield* contentsForTurn(threads.other)).toContain("Answer in British English");
      }),
    );

    it.effect("an agent's write waits for the user to accept it", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const context = yield* store.threadContext(threads.main);
        const remember = (content: string) =>
          store.remember({
            context,
            scope: "project:project-app",
            kind: "rule",
            content,
            actor: "agent",
          });

        const proposed = yield* remember("Run the linter before committing");
        expect(proposed).toMatchObject({ status: "pending", provenance: "agent_inferred" });
        expect(yield* contentsForTurn(threads.main)).not.toContain(
          "Run the linter before committing",
        );

        yield* store.accept(proposed.id);
        expect(yield* contentsForTurn(threads.main)).toContain("Run the linter before committing");

        // Only a person makes a standing rule directly; an agent's write waits for acceptance.
        expect(
          yield* store.remember({
            context,
            scope: "project:project-app",
            kind: "rule",
            content: "Use pnpm, not npm",
            actor: "user",
          }),
        ).toMatchObject({ status: "active", provenance: "user_explicit" });

        // Whitespace-only content saves nothing.
        for (const blank of ["   ", "\n\t"]) {
          expect((yield* remember(blank).pipe(Effect.flip))._tag).toBe("MemoryStoreError");
        }
      }),
    );

    it.effect("every write has a revision and revert restores it", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const context = yield* store.threadContext(threads.main);
        const item = yield* store.remember({
          context,
          scope: "thread:thread-main",
          kind: "fact",
          content: "The release branch is release/2026",
          actor: "user",
        });
        yield* store.forget({ context, itemId: item.id });
        expect(Option.getOrThrow(yield* store.get(item.id)).status).toBe("retired");

        yield* store.revert({ itemId: item.id, revision: 1, actor: "user" });
        expect(Option.getOrThrow(yield* store.get(item.id)).status).toBe("active");
        expect(
          (yield* store.revisions(item.id)).map(({ actor, after }) => [actor, after.status]),
        ).toEqual([
          ["user", "active"],
          ["agent", "retired"],
          ["user", "active"],
        ]);
      }),
    );

    it.effect("bot items are invisible outside that bot's thread", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const botThread: MemoryAccess.MemoryThreadContext = {
          ...(yield* store.threadContext(threads.main)),
          botId: "bot-1",
        };
        const item = yield* store.remember({
          context: botThread,
          scope: "bot:bot-1",
          kind: "rule",
          content: "Report in one paragraph",
          actor: "user",
        });
        const rulesIn = (context: typeof botThread) =>
          store
            .forTurn({ context, text: "", factLimit: 8 })
            .pipe(Effect.map(({ rules }) => rules.map(({ id }) => id)));

        expect(yield* rulesIn(botThread)).toContain(item.id);
        expect(yield* rulesIn({ ...botThread, botId: null })).not.toContain(item.id);
        expect(yield* rulesIn({ ...botThread, botId: "bot-2" })).not.toContain(item.id);
        expect(
          yield* store
            .forget({ context: { ...botThread, botId: null }, itemId: item.id })
            .pipe(Effect.flip),
        ).toBeInstanceOf(MemoryStore.MemoryItemNotFoundError);
      }),
    );

    it.effect("repository items follow the project across worktrees and clones", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        yield* store.remember({
          context: yield* store.threadContext(threads.main),
          scope: "repo:github.com/acme/app",
          kind: "rule",
          content: "Tests live beside the code",
          actor: "user",
        });
        expect(yield* contentsForTurn(threads.worktree)).toContain("Tests live beside the code");
        expect(yield* contentsForTurn(threads.clone)).toContain("Tests live beside the code");
        expect(yield* contentsForTurn(threads.other)).not.toContain("Tests live beside the code");
      }),
    );

    it.effect("redacts secrets before saving", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const item = yield* store.remember({
          context: yield* store.threadContext(threads.main),
          scope: "thread:thread-main",
          kind: "fact",
          content: `The CI token is ghp_${"a".repeat(36)}`,
          actor: "user",
        });
        expect(item.content).toBe("The CI token is [redacted]");
      }),
    );

    it.effect("a thread that cannot be read gets no memory", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        expect((yield* store.resolveThread(ThreadId.make("thread-missing"))).mode).toBe(
          "temporary",
        );
        expect((yield* store.resolveThread(threads.main.id)).repoKey).toBe("github.com/acme/app");
      }),
    );
  });
});

describe("MemoryStore: a person's edits and thread modes", () => {
  it.layer(layerMemoryTest({ memoryEnabled: true }))((it) => {
    const save = Effect.fn("save")(function* (
      content: string,
      options: { readonly actor?: MemoryStore.MemoryActor; readonly scope?: string } = {},
    ) {
      const store = yield* MemoryStore.MemoryStore;
      return yield* store.remember({
        context: yield* store.threadContext(threads.parent),
        scope: options.scope ?? "project:project-app",
        kind: "fact",
        content,
        actor: options.actor ?? "user",
      });
    });

    it.effect("lists by scope kind and status", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const everywhere = yield* save("Lists: answer briefly", { scope: "global" });
        const proposal = yield* save("Lists: the API lives in api/", { actor: "agent" });

        const ids = (items: ReadonlyArray<MemoryItem>) => items.map((item) => item.id);
        expect(ids(yield* store.list({ scopeKind: "global" }))).toContain(everywhere.id);
        expect(ids(yield* store.list({ scopeKind: "global" }))).not.toContain(proposal.id);
        expect(ids(yield* store.list({ scopeKind: "project", status: "pending" }))).toEqual(
          expect.arrayContaining([proposal.id]),
        );
        expect(ids(yield* store.list({ status: "active" }))).not.toContain(proposal.id);
      }),
    );

    it.effect("an edit is a revision, keeps scope and provenance, and can be reverted", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const item = yield* save("Edit: deploys go out on Tuesdays", { actor: "agent" });

        expect(yield* store.edit({ itemId: item.id, content: item.content })).toEqual(item);
        expect(yield* store.revisions(item.id)).toHaveLength(1);

        const edited = yield* store.edit({
          itemId: item.id,
          content: "  Edit: deploys go out on Thursdays ",
          kind: "rule",
        });
        expect(edited).toMatchObject({
          content: "Edit: deploys go out on Thursdays",
          kind: "rule",
          scope: item.scope,
          provenance: "agent_inferred",
          status: "pending",
        });
        expect(
          (yield* store.edit({ itemId: item.id, content: "   " }).pipe(Effect.flip))._tag,
        ).toBe("MemoryStoreError");

        yield* store.revert({ itemId: item.id, revision: 1, actor: "user" });
        expect(Option.getOrThrow(yield* store.get(item.id)).content).toBe(
          "Edit: deploys go out on Tuesdays",
        );
      }),
    );

    it.effect("a bulk preview writes nothing and applying writes exactly what it showed", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const first = yield* save("Bulk: use vitest", { actor: "agent" });
        const second = yield* save("Bulk: use oxlint", { actor: "agent" });
        const accepted = yield* save("Bulk: already active");
        const input = {
          items: [first, second, accepted],
          operation: { type: "accept" as const },
        };

        const preview = yield* store.bulkEdit({ ...input, apply: false });
        expect(preview.matchedCount).toBe(3);
        expect(preview.changes.map(({ before, after }) => [before.id, after.status])).toEqual([
          [first.id, "active"],
          [second.id, "active"],
        ]);
        expect(Option.getOrThrow(yield* store.get(first.id)).status).toBe("pending");

        const applied = yield* store.bulkEdit({ ...input, apply: true });
        expect(applied.changes.map(({ after }) => after.provenance)).toEqual([
          "user_confirmed",
          "user_confirmed",
        ]);
        expect(Option.getOrThrow(yield* store.get(second.id)).status).toBe("active");

        // The same selection is now stale: applying it again changes nothing.
        const stale = yield* store.bulkEdit({ ...input, apply: true }).pipe(Effect.flip);
        expect(stale).toBeInstanceOf(MemoryStore.MemorySelectionStaleError);
      }),
    );

    it.effect("a stale item refuses the whole edit", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const kept = yield* save("Stale: keep me", { actor: "agent" });
        const changed = yield* save("Stale: change me", { actor: "agent" });
        yield* store.edit({ itemId: changed.id, content: "Stale: changed elsewhere" });

        const error = yield* store
          .bulkEdit({
            items: [kept, changed],
            operation: { type: "retire" },
            apply: true,
          })
          .pipe(Effect.flip);
        expect(error).toEqual(new MemoryStore.MemorySelectionStaleError({ itemIds: [changed.id] }));
        expect(Option.getOrThrow(yield* store.get(kept.id)).status).toBe("pending");
      }),
    );

    it.effect("restoring a retired item brings back the status it had", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const proposal = yield* save("Restore: a rejected proposal", { actor: "agent" });
        const active = yield* save("Restore: an active item");
        const apply = (items: ReadonlyArray<MemoryItem>, type: "retire" | "restore") =>
          store.bulkEdit({ items, operation: { type }, apply: true });

        const retired = (yield* apply([proposal, active], "retire")).changes.map(
          ({ after }) => after,
        );
        const restored = (yield* apply(retired, "restore")).changes.map(({ after }) => [
          after.id,
          after.status,
        ]);
        expect(restored).toEqual([
          [proposal.id, "pending"],
          [active.id, "active"],
        ]);
      }),
    );

    it.effect("replace text is literal and follows the case setting", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const item = yield* save("Replace: run (npm) test, then NPM build");
        const replace = (find: string, matchCase: boolean) =>
          store.bulkEdit({
            items: [item],
            operation: { type: "replace_text", find, replacement: "pnpm", matchCase },
            apply: false,
          });

        expect((yield* replace("(npm)", true)).changes[0]?.after.content).toBe(
          "Replace: run pnpm test, then NPM build",
        );
        expect((yield* replace("npm", true)).changes[0]?.after.content).toBe(
          "Replace: run (pnpm) test, then NPM build",
        );
        expect((yield* replace("npm", false)).changes[0]?.after.content).toBe(
          "Replace: run (pnpm) test, then pnpm build",
        );
        expect((yield* replace("yarn", false)).changes).toEqual([]);
      }),
    );

    it.effect("a fork takes a copy of its parent's mode", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        expect(yield* store.threadMode(threads.parent.id)).toBe("persistent");
        yield* store.setThreadMode(threads.parent.id, "incognito");

        expect(yield* store.threadMode(threads.forkOfFork.id)).toBe("incognito");
        expect((yield* store.threadContext(threads.fork)).mode).toBe("incognito");

        // A copy: promoting the parent later leaves its forks as they were.
        yield* store.setThreadMode(threads.parent.id, "persistent");
        expect(yield* store.threadMode(threads.fork.id)).toBe("incognito");
        expect(yield* store.threadMode(threads.forkOfFork.id)).toBe("incognito");
      }),
    );

    it.effect("an agent can only make a thread's memory more private", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        expect(yield* store.restrictThreadMode(threads.other.id, "incognito")).toBe("incognito");
        expect(yield* store.restrictThreadMode(threads.other.id, "temporary")).toBe("temporary");
        expect(yield* store.restrictThreadMode(threads.other.id, "incognito")).toBe("temporary");
        expect(yield* store.threadMode(threads.other.id)).toBe("temporary");
      }),
    );

    it.effect("lists what each turn was given, newest first", () =>
      Effect.gen(function* () {
        const store = yield* MemoryStore.MemoryStore;
        const rule = yield* save("Injections: answer in English");
        yield* store.recordInjections({
          threadId: threads.clone.id,
          runId: "run-1",
          itemIds: [rule.id],
        });
        yield* TestClock.adjust("1 minute");
        yield* store.recordInjections({
          threadId: threads.clone.id,
          runId: "run-2",
          itemIds: [rule.id],
        });

        expect(
          (yield* store.injections(threads.clone.id)).map(({ runId, item }) => [runId, item.id]),
        ).toEqual([
          ["run-2", rule.id],
          ["run-1", rule.id],
        ]);
        expect(yield* store.injections(threads.worktree.id)).toEqual([]);
      }),
    );
  });
});
