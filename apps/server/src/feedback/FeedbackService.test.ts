
import { expect, it } from "@effect/vitest";
import {
  type AgentFeedbackMode,
  DEFAULT_SERVER_SETTINGS,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type Project,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Settings from "../serverSettings.ts";
import {
  FEEDBACK_AWAITING_APPROVAL_NOTE,
  FeedbackInput,
  FeedbackStorageError,
} from "./FeedbackReport.ts";
import { listFeedbackReports } from "./FeedbackList.ts";
import * as Feedback from "./FeedbackService.ts";
import { buildFeedbackTrace } from "./FeedbackTrace.ts";
import * as Store from "./FeedbackStore.ts";

const threadId = ThreadId.make("thread:feedback");
const instanceId = ProviderInstanceId.make("work-codex");

const at = (ms: number) => DateTime.makeUnsafe(ms);
const run = (ordinal: number, started = true) =>
  ({
    id: RunId.make(`run:${ordinal}`),
    ordinal,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "gpt-5.5" },
    rootNodeId: `node:${ordinal}`,
    startedAt: started ? at(ordinal * 60_000) : null,
  }) as unknown as OrchestrationV2Run;
let ordinal = 0;
const item = (runOrdinal: number, fields: Record<string, unknown>) =>
  ({
    runId: RunId.make(`run:${runOrdinal}`),
    parentItemId: null,
    ordinal: ordinal++,
    status: "completed",
    startedAt: null,
    completedAt: null,
    ...fields,
  }) as unknown as OrchestrationV2TurnItem;
// Four queued runs after the six started ones: the trace still covers five started turns.
const runs = [1, 2, 3, 4, 5, 6]
  .map((ordinal) => run(ordinal))
  .concat([7, 8, 9, 10].map((ordinal) => run(ordinal, false)));
const turnItems = [
  item(1, { type: "user_message", text: "Outside the window." }),
  ...[2, 3, 4, 5].map((turn) => item(turn, { type: "user_message", text: `Ask ${turn}.` })),
  ...Array.from({ length: 100 }, () => item(3, { type: "command_execution", exitCode: 0 })),
  item(5, { type: "assistant_message", text: "Done in /srv/checkouts/acme-app-7." }),
  item(6, {
    type: "dynamic_tool",
    toolName: "mcp__t3-code__t3_thread_read",
    status: "failed",
    startedAt: at(0),
    completedAt: at(1_500),
  }),
  item(6, {
    type: "dynamic_tool",
    toolName: "mcp__linear__get_issue",
    toolSource: { key: "linear", name: "Linear", kind: "integration" },
  }),
  item(6, { type: "dynamic_tool", toolName: "Read", parentItemId: "parent" }),
  item(6, { type: "dynamic_tool", toolName: "Read" }),
  item(6, { type: "command_execution", exitCode: 1 }),
  item(6, {
    type: "user_message",
    text: `Look at /srv/acme-app/src/a.ts\nwith sk-proj-abcdefghij1234567890 ${"y".repeat(1_500)}`,
  }),
  ...[2, 6].flatMap((turn) =>
    Array.from({ length: 6 }, () =>
      item(turn, { type: "assistant_message", text: "z".repeat(2_000) }),
    ),
  ),
  item(6, { type: "dynamic_tool", toolName: "t3-code.t3_thread_read", status: "running" }),
  item(5, { type: "dynamic_tool", toolName: "mcp__t3-code__t3_feedback", status: "running" }),
  item(6, { type: "dynamic_tool", toolName: "mcp__t3-code__t3_feedback", status: "failed" }),
  // The call making the card in the active run, as Claude names it and as OpenCode 2 does.
  item(6, { type: "dynamic_tool", toolName: "mcp__t3-code__t3_feedback", status: "running" }),
  item(6, { type: "dynamic_tool", toolName: "t3-code-thread_1_t3_feedback", status: "running" }),
];

it("says so when the report asks for more turns than a trace can hold", () => {
  const many = Array.from({ length: 81 }, (_, index) => run(index + 1));
  const trace = (turns: number) =>
    buildFeedbackTrace({
      runs: many,
      items: many.map((_, index) => item(index + 1, { type: "user_message", text: "Hi" })),
      turns,
      withText: true,
      sensitive: [],
      t3Tools: [],
      driverOf: () => undefined,
      submittingRunId: many.at(-1)!.id,
    });
  expect(trace(100)).toMatchObject({ turns: 80, textTurns: 80, truncated: true });
  expect(trace(80)).toMatchObject({ turns: 80, textTurns: 80, truncated: false });
});

const harness = Effect.gen(function* () {
  const mode = yield* Ref.make<AgentFeedbackMode>("auto");
  // As in the service: updates and snapshots share one lock, and a read outside the lock can
  // capture the settings and finish later. Arming `reading` makes the next read signal `begun`;
  // an unlocked read signals after capturing and returns what it captured only on `release`.
  const settingsLock = yield* Semaphore.make(1);
  const reading = yield* Ref.make<
    | { readonly begun: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
    | undefined
  >(undefined);
  const readSettings = Ref.get(mode).pipe(
    Effect.map((mode) => ({ ...DEFAULT_SERVER_SETTINGS, agentFeedback: { mode } })),
  );
  const unlockedRead = Effect.gen(function* () {
    const captured = yield* readSettings;
    const armed = yield* Ref.getAndSet(reading, undefined);
    if (armed !== undefined) {
      yield* Deferred.succeed(armed.begun, undefined);
      yield* Deferred.await(armed.release);
    }
    return captured;
  });
  const snapshotBegins = Ref.getAndSet(reading, undefined).pipe(
    Effect.flatMap((armed) =>
      armed === undefined ? Effect.void : Deferred.succeed(armed.begun, undefined),
    ),
  );
  const items = yield* Ref.make(turnItems);
  const runId = yield* Ref.make(RunId.make("run:1"));
  const events = yield* Ref.make<ReadonlyArray<readonly [string, unknown]>>([]);
  // Every feedback card the service records, in order.
  const cards = yield* Queue.unbounded<CardRecord>();
  // The cards as the thread stores them, each its latest record.
  const shown = yield* Ref.make(new Map<string, CardRecord>());
  // Faults and gates for card records, and a signal when an answer reads its card.
  const failRecords = yield* Ref.make(false);
  // Each gate holds the first record of its status until released.
  const recordGates = yield* Ref.make<
    ReadonlyArray<{
      readonly status: CardRecord["feedbackStatus"];
      readonly entered: Deferred.Deferred<void>;
      readonly release: Deferred.Deferred<void>;
    }>
  >([]);
  // The projection rows the store reads share the database, as in the server.
  const threads = Layer.unwrap(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      for (const run of runs) {
        yield* sql`INSERT INTO orchestration_v2_projection_runs ${sql.insert({
          run_id: run.id,
          thread_id: threadId,
          ordinal: run.ordinal,
          provider: "codex",
          status: "running",
          requested_at: "2026-01-01T00:00:00.000Z",
          payload_json: "{}",
        })}`;
      }
      const project = (card: CardRecord) => sql`
        INSERT INTO orchestration_v2_projection_turn_items ${sql.insert({
          turn_item_id: card.turnItemId,
          thread_id: threadId,
          run_id: card.runId,
          ordinal: 0,
          type: "feedback_request",
          status:
            card.feedbackStatus === "pending"
              ? "waiting"
              : card.feedbackStatus === "sent"
                ? "completed"
                : "cancelled",
          updated_at: "2026-01-01T00:00:00.000Z",
          payload_json: "{}",
        })}
        ON CONFLICT (turn_item_id) DO UPDATE SET status = excluded.status
        WHERE orchestration_v2_projection_turn_items.status = 'waiting'`;
      return Layer.mock(Threads.ThreadManagementService)({
        dispatch: (command) =>
          Effect.gen(function* () {
            const card = command as CardRecord;
            if (card.feedbackStatus !== "pending" && (yield* Ref.get(failRecords))) {
              return yield* new FeedbackStorageError({ cause: "The card record failed." });
            }
            const gate = (yield* Ref.get(recordGates)).find(
              (candidate) => candidate.status === card.feedbackStatus,
            );
            if (gate !== undefined) {
              yield* Ref.update(recordGates, (gates) => gates.filter((other) => other !== gate));
              yield* Deferred.succeed(gate.entered, undefined);
              yield* Deferred.await(gate.release);
            }
            yield* Ref.update(shown, (cards) => {
              const existing = cards.get(card.turnItemId);
              // A decided card stays decided, as the orchestrator keeps it.
              return existing === undefined || existing.feedbackStatus === "pending"
                ? new Map(cards).set(card.turnItemId, card)
                : cards;
            });
            yield* project(card).pipe(Effect.orDie);
            yield* Queue.offer(cards, card);
            return {};
          }) as never,
        getThreadRecords: (_threadId, fields, filter) =>
          Effect.gen(function* () {
            const stored = yield* Ref.get(items);
            const wanted = fields as ReadonlyArray<string>;
            const selected =
              filter?.runIds === undefined
                ? filter?.latestRunLimit === undefined
                  ? runs
                  : runs.slice(-filter.latestRunLimit)
                : runs.filter((run) => filter.runIds?.includes(run.id));
            return {
              ...(wanted.includes("runs") ? { runs: selected } : {}),
              ...(wanted.includes("turnItems")
                ? {
                    turnItems: filter?.turnItemTypes?.includes("feedback_request")
                      ? [...(yield* Ref.get(shown)).values()].map(
                          ({ type: _record, commandId: _id, turnItemId, ...card }) => ({
                            ...card,
                            type: "feedback_request",
                            id: turnItemId,
                          }),
                        )
                      : stored.filter(
                          (item) =>
                            filter?.turnItemRunIds?.includes(item.runId) === true &&
                            filter.turnItemTypes?.includes(item.type) === true,
                        ),
                  }
                : {}),
            };
          }) as never,
        getThreadShell: () =>
          Ref.get(runId).pipe(
            Effect.map((activeRunId) => ({
              ...liveThreadShell(threadId, { activeRunId }),
              modelSelection: { instanceId, model: "gpt-5.5" },
              branch: "acme/secret-launch",
              worktreePath: "/srv/checkouts/acme-app-7",
            })),
          ),
      });
    }),
  );
  const layer = Feedback.layer(() => ["t3_thread_read", "t3_feedback"]).pipe(
    Layer.provideMerge(Store.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        threads,
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: unlockedRead,
          withSettingsSnapshot: (use) =>
            snapshotBegins.pipe(
              Effect.andThen(settingsLock.withPermits(1)(readSettings.pipe(Effect.flatMap(use)))),
            ),
        }),
        Layer.mock(Projects.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              title: "Acme Payments",
              workspaceRoot: "/srv/acme-app",
              repositoryIdentity: {
                canonicalKey: "github.com/acme/payments",
                locator: {
                  source: "git-remote",
                  remoteName: "origin",
                  remoteUrl: "git@github.com:acme/payments.git",
                },
              },
            } as unknown as Project),
        }),
        Layer.mock(Providers.ProviderRegistry)({
          getProviders: Effect.succeed([
            {
              instanceId,
              driver: "codex",
              auth: { status: "authenticated" },
              models: [{ slug: "gpt-5.5", isCustom: false }],
            } as unknown as ServerProvider,
          ]),
        }),
        SecureRandom.layerWebCrypto,
      ),
    ),
    Layer.provideMerge(SqlitePersistence.layerMemory),
  );
  return {
    mode,
    settingsLock,
    reading,
    items,
    runId,
    events,
    cards,
    shown,
    failRecords,
    recordGates,
    layer,
  };
});

type CardRecord = Extract<
  Parameters<Threads.ThreadManagementService["Service"]["dispatch"]>[0],
  { readonly type: "feedback_request.record" }
>;

const awaiting = { status: "awaiting_approval", note: FEEDBACK_AWAITING_APPROVAL_NOTE };

/** Shows a requested report's card, which the call returns from at once. */
const show = (cards: Queue.Queue<CardRecord>, report: FeedbackInput) =>
  Effect.gen(function* () {
    const feedback = yield* Feedback.FeedbackService;
    expect(yield* feedback.submit(report, fromThread)).toEqual(awaiting);
    const card = yield* Queue.take(cards);
    expect(card.feedbackStatus).toBe("pending");
    return card;
  });

const answer = (card: CardRecord, reply: "send" | "decline", includeConversation = false) =>
  Effect.gen(function* () {
    const store = yield* Store.FeedbackStore;
    yield* store.answer({
      threadId,
      turnItemId: card.turnItemId,
      answer: reply,
      includeConversation,
    });
  });

const input = {
  kind: "bug" as const,
  subject: "t3_thread_read",
  expected: "Items for a completed thread.",
  actual: "No items.",
  workaround: "",
  userRequested: false,
  turns: 1,
};
const requested = { ...input, userRequested: true };
const fromThread = { source: "mcp" as const, threadId };

it.effect("stores nothing and fails when agent feedback is off", () =>
  Effect.gen(function* () {
    const { mode, events, layer } = yield* harness;
    yield* Ref.set(mode, "off");
    yield* Effect.gen(function* () {
      const feedback = yield* Feedback.FeedbackService;
      const error = yield* Effect.flip(feedback.submit(input, fromThread));
      expect(error._tag).toBe("FeedbackOffError");
      expect(error.message).toContain("Settings > Labs");
      expect((yield* Effect.flip(listFeedbackReports))._tag).toBe("FeedbackOffError");
    }).pipe(Effect.provide(layer));
    expect(yield* Ref.get(events)).toEqual([]);
  }),
);

it.effect(
  "allows 3 unprompted reports and 3 cards per turn, and 10 reports an hour outside a turn",
  () =>
    Effect.gen(function* () {
      const { mode, runId, events, cards, layer } = yield* harness;
      yield* Effect.gen(function* () {
        const feedback = yield* Feedback.FeedbackService;
        const limited = Effect.flip(feedback.submit(input, fromThread)).pipe(
          Effect.map((error) => error._tag),
        );
        for (const subject of ["", "acme payments roadmap", "mcp__other__t3_thread_read"]) {
          const error = yield* Effect.flip(feedback.submit({ ...input, subject }, fromThread));
          expect(error.message).toBe(
            "Set subject to the exact T3 tool name, the t3 command, or `general`.",
          );
        }
        const refused = (report: Partial<typeof input>, caller: Feedback.FeedbackCaller) =>
          Effect.flip(feedback.submit({ ...input, ...report }, caller)).pipe(
            Effect.map((error) => error.message),
          );
        // Only a thread can show the user a requested report to approve.
        expect(yield* refused({ userRequested: true }, { source: "cli" })).toBe(
          "A report the user asks for is shown to them for approval in their thread, and this call has no active thread turn, so nothing was sent.",
        );
        yield* Ref.set(mode, "on-request");
        expect(yield* refused({}, fromThread)).toBe(
          "Agent feedback is set to When I ask: send a report only when the user asks for one.",
        );
        expect(yield* refused({}, { source: "cli" })).toBe(
          "Agent feedback is set to When I ask: ask your agent in a thread to send it, so you can approve what is sent.",
        );
        yield* Ref.set(mode, "auto");
        expect(yield* Ref.get(events)).toEqual([]);
        yield* Effect.replicateEffect(feedback.submit(input, fromThread), 3, { discard: true });
        expect(yield* limited).toBe("FeedbackLimitError");
        // Cards count when shown, answered or not, and apart from unprompted reports.
        const [first] = yield* Effect.replicateEffect(show(cards, requested), 3);
        yield* answer(first!, "decline");
        expect(yield* refused({ userRequested: true }, fromThread)).toBe(
          "This turn already showed the user 3 agent feedback reports to approve; nothing was shown.",
        );
        // No cap per thread: each new turn has room again.
        for (const run of ["run:2", "run:3", "run:4", "run:5"]) {
          yield* Ref.set(runId, RunId.make(run));
          yield* Effect.replicateEffect(feedback.submit(input, fromThread), 3, { discard: true });
        }
        expect((yield* Effect.flip(feedback.submit(input, fromThread))).message).toBe(
          "This turn already sent 3 agent feedback reports; nothing was sent.",
        );
        // Outside a turn, such as `t3 feedback`, 10 an hour.
        const fromCli = { source: "cli" as const };
        yield* Effect.replicateEffect(feedback.submit(input, fromCli), 10, { discard: true });
        expect((yield* Effect.flip(feedback.submit(input, fromCli))).message).toBe(
          "This machine already sent 10 agent feedback reports outside a turn in the last hour; nothing was sent.",
        );
        yield* TestClock.adjust("1 hour");
        yield* feedback.submit(input, fromCli);
        expect(yield* listFeedbackReports).toHaveLength(26);
      }).pipe(Effect.provide(layer));
    }),
);

it.effect("a mode switch under way when a report is stored wins", () =>
  Effect.gen(function* () {
    const { mode, settingsLock, reading, events, cards, layer } = yield* harness;
    yield* Effect.gen(function* () {
      const feedback = yield* Feedback.FeedbackService;
      const nothingKept = Effect.gen(function* () {
        yield* Ref.set(mode, "auto");
        expect(yield* listFeedbackReports).toEqual([]);
        expect(yield* Ref.get(events)).toEqual([]);
      });
      /**
       * Holds a switch to `to` mid-write under the settings lock, runs `start` until storing reads
       * the settings, then lets the switch finish. A read outside the lock has captured the old
       * mode by then, and returns it only after the switch.
       */
      const switchDuring = <A, E, R>(to: AgentFeedbackMode, start: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const gate = yield* Deferred.make<void>();
          const updating = yield* Deferred.make<void>();
          const update = yield* settingsLock
            .withPermits(1)(
              Deferred.succeed(updating, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.andThen(Ref.set(mode, to)),
              ),
            )
            .pipe(Effect.forkChild);
          yield* Deferred.await(updating);
          const begun = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          yield* Ref.set(reading, { begun, release });
          const call = yield* Effect.forkChild(start);
          yield* Deferred.await(begun);
          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(update);
          yield* Deferred.succeed(release, undefined);
          return yield* Effect.result(Fiber.join(call));
        });

      // Automatic to Off while Send stores the card's report: nothing kept, the card closes.
      const card = yield* show(cards, requested);
      expect(yield* switchDuring("off", answer(card, "send"))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "AgentFeedbackRequestError", reason: "feedback_off" },
      });
      expect((yield* Queue.take(cards)).feedbackStatus).toBe("cancelled");
      yield* nothingKept;

      // Automatic to When I ask while an unprompted report is on its way: refused as itself.
      expect(yield* switchDuring("on-request", feedback.submit(input, fromThread))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "FeedbackNotRequestedError" },
      });
      yield* nothingKept;
    }).pipe(Effect.provide(layer));
  }),
);
