import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

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

    it.effect("an agent's write waits for the user unless the user started the turn", () =>
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
