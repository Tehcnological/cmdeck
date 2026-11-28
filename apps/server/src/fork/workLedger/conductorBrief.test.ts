import { describe, expect, it } from "@effect/vitest";
import { ProjectId, RunId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AgentDiscipline from "../agentDiscipline/AgentDiscipline.ts";
import * as MemoryStore from "../memory/MemoryStore.ts";
import * as TurnContext from "../memory/TurnContext.ts";
import { CONDUCTOR_BRIEF } from "./conductorBrief.ts";
import * as WorkLedger from "./WorkLedger.ts";
import { layerWorkLedgerTest, threads } from "./workLedger.testkit.ts";

// Memory is off and inert here; only the conductor contributor can add a section.
const layer = TurnContext.layer.pipe(
  Layer.provideMerge(Layer.mock(MemoryStore.MemoryStore)({ enabled: Effect.succeed(false) })),
  Layer.provideMerge(
    Layer.mock(AgentDiscipline.AgentDiscipline)({
      claudeHooks: () => ({}),
      guidance: () => Effect.succeed([]),
    }),
  ),
  Layer.provideMerge(layerWorkLedgerTest),
);

const contextFor = (threadId: (typeof threads)[keyof typeof threads]) =>
  TurnContext.TurnContext.use((turnContext) =>
    turnContext.contribute({
      thread: { id: threadId, projectId: ProjectId.make("project-app") },
      runId: RunId.make("run-1"),
      message: { text: "Clear the flaky-test backlog", createdBy: "user" },
      inject: true,
    }),
  );

describe("conductor brief", () => {
  it.layer(layer)((it) => {
    it.effect("reaches a conductor's turns only while it is a conductor", () =>
      Effect.gen(function* () {
        const ledger = yield* WorkLedger.WorkLedger;
        expect(yield* contextFor(threads.stranger)).toBe("");
        yield* ledger.setConductor(threads.stranger, true);
        const block = yield* contextFor(threads.stranger);
        expect(block).toContain("## Conductor");
        for (const entry of CONDUCTOR_BRIEF) expect(block).toContain(entry);
        yield* ledger.setConductor(threads.stranger, false);
        expect(yield* contextFor(threads.stranger)).toBe("");
      }),
    );

    it.effect("stops reaching a conductor that still has items once it stops conducting", () =>
      Effect.gen(function* () {
        const ledger = yield* WorkLedger.WorkLedger;
        yield* ledger.record(threads.conductor, {
          action: "create",
          title: "Fix the flaky upload test",
          acceptance: "CI is green",
        });
        expect(yield* contextFor(threads.conductor)).toContain("## Conductor");
        yield* ledger.setConductor(threads.conductor, false);
        expect(yield* contextFor(threads.conductor)).toBe("");
        expect(yield* ledger.list(threads.conductor)).toHaveLength(1);
      }),
    );
  });
});
