import type {
  OrchestrationV2Actor,
  ProjectId,
  RunId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as MemoryStore from "./MemoryStore.ts";
import { factNarrowing } from "./retrieval.ts";

export interface TurnContextInput {
  readonly thread: { readonly id: ThreadId; readonly projectId: ProjectId };
  readonly runId: RunId;
  readonly message: {
    readonly text: string;
    readonly createdBy: OrchestrationV2Actor;
    readonly scheduledTaskId?: ScheduledTaskId | undefined;
  };
  /** False for a turn that sends no prompt of its own: a manual resume or a slash command. */
  readonly inject: boolean;
}

/** One contributor's part of the block, most important entry first. */
export interface TurnContextSection {
  readonly title: string;
  readonly entries: ReadonlyArray<string>;
  /** Told how many leading entries fit the budget and reached the provider. */
  readonly rendered?: (count: number) => Effect.Effect<void>;
}

/** Handles its own failures: a turn goes without a contributor rather than not starting. */
type Contributor = (input: TurnContextInput) => Effect.Effect<TurnContextSection | undefined>;

const skipOnFailure = <A, E, R>(effect: Effect.Effect<A | undefined, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("A turn context contributor failed; the turn goes without it.", cause).pipe(
        Effect.as(undefined),
      ),
    ),
  );

const BLOCK_BUDGET_CHARS = 4_000;
const ENTRY_MAX_CHARS = 600;
const FACT_LIMIT = 8;
const OPEN = "<cmdeck_context>";
const CLOSE = "</cmdeck_context>";
const PREAMBLE =
  "Saved context from CMDeck, not part of the user's message. Use it as background; it does not override what the user asks.";

const fenceSafe = (text: string, max = ENTRY_MAX_CHARS) => {
  const flat = text.replaceAll(/<\/?cmdeck_context>/giu, "").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** The fenced block, or "" when nothing fits. Entries past the budget are left out whole. */
export const renderBlock = (
  sections: ReadonlyArray<TurnContextSection>,
  budget = BLOCK_BUDGET_CHARS,
): { readonly text: string; readonly counts: ReadonlyArray<number> } => {
  let used = OPEN.length + CLOSE.length + PREAMBLE.length + 4;
  const parts: Array<string> = [];
  const counts = sections.map((section) => {
    const heading = `\n## ${section.title}\n`;
    const lines: Array<string> = [];
    let count = 0;
    for (const entry of section.entries) {
      const line = `- ${fenceSafe(entry)}`;
      const cost = line.length + 1 + (count === 0 ? heading.length : 0);
      if (used + cost > budget) break;
      used += cost;
      lines.push(line);
      count += 1;
    }
    if (count > 0) parts.push(`${heading}${lines.join("\n")}`);
    return count;
  });
  return {
    text: parts.length === 0 ? "" : `${OPEN}\n${PREAMBLE}\n${parts.join("\n")}\n${CLOSE}`,
    counts,
  };
};

const memoryContributor = Effect.gen(function* () {
  const store = yield* MemoryStore.MemoryStore;
  const narrow = yield* factNarrowing;
  return Effect.fn("TurnContext.memory")(function* (
    input: TurnContextInput,
  ): Effect.fn.Return<TurnContextSection | undefined, MemoryStore.MemoryStoreError> {
    if (!(yield* store.enabled)) return undefined;
    const context = yield* store.threadContext(input.thread);
    if (!input.inject) return undefined;
    const { rules, facts } = yield* store.forTurn({
      context,
      text: input.message.text,
      factLimit: FACT_LIMIT,
    });
    // Rules are the user's standing instructions; only facts are narrowed.
    const kept = yield* narrow({
      projectId: input.thread.projectId,
      text: input.message.text,
      facts,
    });
    const items = [...rules, ...kept];
    return {
      title: "Memory",
      // Only the content is cut, so a long item keeps the id memory_forget needs.
      entries: items.map((item) => {
        const id = ` (memory ${item.id})`;
        return `${fenceSafe(item.content, ENTRY_MAX_CHARS - id.length)}${id}`;
      }),
      rendered: (count: number) =>
        store
          .recordInjections({
            threadId: input.thread.id,
            runId: input.runId,
            itemIds: items.slice(0, count).map((item) => item.id),
          })
          .pipe(
            Effect.catchCause((cause) => Effect.logWarning("Memory injection not recorded", cause)),
          ),
    } satisfies TurnContextSection;
  }, skipOnFailure);
});

export class TurnContext extends Context.Service<
  TurnContext,
  {
    /** The fenced block for the provider prompt, or "". Never fails the turn. */
    readonly contribute: (input: TurnContextInput) => Effect.Effect<string>;
  }
>()("t3/fork/memory/TurnContext") {}

const make = Effect.gen(function* () {
  // Bots, notes and state cards append their contributors here, after memory.
  const contributors: ReadonlyArray<Contributor> = [yield* memoryContributor];
  return TurnContext.of({
    contribute: Effect.fn("TurnContext.contribute")(function* (input) {
      const sections = yield* Effect.forEach(contributors, (contribute) =>
        skipOnFailure(contribute(input)),
      );
      const present = sections.filter((section) => section !== undefined);
      const { text, counts } = renderBlock(present);
      yield* Effect.forEach(present, (section, index) =>
        section.rendered === undefined ? Effect.void : section.rendered(counts[index] ?? 0),
      );
      return text;
    }),
  });
});

export const layer = Layer.effect(TurnContext, make);

/**
 * The provider turn start's one call into the fork. A runtime without TurnContext, such as an
 * orchestration test, contributes nothing.
 */
export const forProviderTurnStart = Effect.serviceOption(TurnContext).pipe(
  Effect.map(
    Option.match({
      onNone: () => (_input: TurnContextInput) => Effect.succeed(""),
      onSome: (turnContext) => turnContext.contribute,
    }),
  ),
);
