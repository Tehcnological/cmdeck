import { describe, expect, it } from "@effect/vitest";
import { type MemoryItem, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { Decisions, isLocalModelAddress, routeScheduledTask } from "./Decisions.ts";
import {
  layerDecisionsTest,
  LOCAL_GENERATOR,
  makeFakeModel,
  REMOTE_GENERATOR,
} from "./decisions.testkit.ts";
import { narrower } from "./points/memoryNarrowing.ts";
import { annotateApproval } from "./points/riskAnnotation.ts";
import { decideWake, type WakeInput } from "./points/wakeSuppression.ts";

const project = ProjectId.make("project-app");
const otherProject = ProjectId.make("project-other");
const localModel = { decisionModel: { instanceId: LOCAL_GENERATOR, model: "qwen3" } };
const remoteModel = { decisionModel: { instanceId: REMOTE_GENERATOR, model: "hosted" } };

const tick: WakeInput = {
  projectId: project,
  instruction: "Tell me when CI fails",
  evidence: "Nothing changed",
  failing: false,
  ending: false,
};
const quiet = { needs_owner: { value: "quiet", confidence: 0.95 } };

describe("isLocalModelAddress", () => {
  it.each([
    ["http://127.0.0.1:11434/v1", true],
    ["http://localhost:1234", true],
    ["http://192.168.5.20:8080/v1", true],
    ["http://studio.tail1234.ts.net:8000", true],
    ["http://100.81.10.2:8000", true],
    ["https://api.openai.com/v1", false],
    ["not a url", false],
  ] as const)("%s → %s", (url, local) => {
    expect(isLocalModelAddress(url)).toBe(local);
  });
});

describe("Decisions", () => {
  it.effect("with no model configured, every point takes its rule and makes no call", () => {
    const model = makeFakeModel();
    model.replyWith(quiet);
    return Effect.gen(function* () {
      const decisions = yield* Decisions;
      yield* decisions.setConsent({ point: "wakeSuppression", projectId: null, source: "local" });
      expect(yield* decideWake(tick)).toBe("wake");
      expect(model.prompts).toEqual([]);
    }).pipe(Effect.provide(layerDecisionsTest({ model })));
  });

  it.effect(
    "with a model but no consent for the point, it takes the rule and makes no call",
    () => {
      const model = makeFakeModel();
      model.replyWith(quiet);
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "memoryNarrowing", projectId: null, source: "local" });
        expect(yield* decideWake(tick)).toBe("wake");
        expect(model.prompts).toEqual([]);
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
    },
  );

  it.effect("asks a local model once the point has consent", () => {
    const model = makeFakeModel();
    model.replyWith(quiet);
    return Effect.gen(function* () {
      const decisions = yield* Decisions;
      yield* decisions.setConsent({ point: "wakeSuppression", projectId: null, source: "local" });
      expect(yield* decideWake(tick)).toBe("delay");
      expect(model.prompts).toHaveLength(1);
      expect(model.prompts[0]).toContain("Tell me when CI fails");
    }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
  });

  it.effect(
    "sends nothing to a model off this machine without the project's remote consent",
    () => {
      const model = makeFakeModel();
      model.replyWith(quiet);
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "wakeSuppression", projectId: null, source: "local" });
        expect(yield* decideWake(tick)).toBe("wake");
        expect(model.prompts).toEqual([]);

        yield* decisions.setConsent({
          point: "wakeSuppression",
          projectId: project,
          source: "remote",
        });
        expect(yield* decideWake(tick)).toBe("delay");
        expect(yield* decideWake({ ...tick, projectId: otherProject })).toBe("wake");
        expect(model.prompts).toHaveLength(1);
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: remoteModel } })));
    },
  );

  it.effect(
    "falls back to the rule when the model fails, answers out of domain or times out",
    () => {
      const model = makeFakeModel();
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "wakeSuppression", projectId: null, source: "local" });

        model.failWith("connection refused");
        expect(yield* decideWake(tick)).toBe("wake");

        model.replyWith({ needs_owner: { value: "snooze forever", confidence: 1 } });
        expect(yield* decideWake(tick)).toBe("wake");

        model.hang();
        const pending = yield* Effect.forkChild(decideWake(tick));
        yield* TestClock.adjust("10 seconds");
        expect(yield* Fiber.join(pending)).toBe("wake");
        expect(model.prompts).toHaveLength(3);
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
    },
  );

  it.effect(
    "records consent per point and project, and refuses remote consent for every project",
    () => {
      const model = makeFakeModel();
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "riskAnnotation", projectId: null, source: "local" });
        yield* decisions.setConsent({
          point: "memoryNarrowing",
          projectId: project,
          source: "remote",
        });
        const refused = yield* decisions
          .setConsent({ point: "modelRouting", projectId: null, source: "remote" })
          .pipe(Effect.flip);
        expect(refused.detail).toContain("one project");

        const status = yield* decisions.status;
        expect(status.model).toEqual({ ...localModel.decisionModel, local: true });
        expect(
          status.consents.map(({ point, projectId, source }) => [point, projectId, source]),
        ).toEqual([
          ["memoryNarrowing", project, "remote"],
          ["riskAnnotation", null, "local"],
        ]);

        yield* decisions.setConsent({ point: "riskAnnotation", projectId: null, source: null });
        expect((yield* decisions.status).consents).toHaveLength(1);
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
    },
  );

  describe("risk annotations never change a policy decision", () => {
    it.effect("an allowed call stays allowed however risky it looks", () => {
      const model = makeFakeModel();
      model.replyWith({ risk: { value: "risky", confidence: 1 } });
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "riskAnnotation", projectId: null, source: "local" });
        const destructive = yield* annotateApproval({
          request: { projectId: project, command: "rm -rf ~/work" },
          policy: { decision: "allow" } as const,
        });
        expect(destructive.policy).toEqual({ decision: "allow" });
        expect(destructive.annotation.tier).toBe("risky");
        const flaggedByModel = yield* annotateApproval({
          request: { projectId: project, command: "make release" },
          policy: { decision: "allow" } as const,
        });
        expect(flaggedByModel.policy).toEqual({ decision: "allow" });
        expect(flaggedByModel.annotation.tier).toBe("risky");
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
    });

    it.effect("a denied call stays denied however safe it looks", () => {
      const model = makeFakeModel();
      model.replyWith({ risk: { value: "safe", confidence: 1 } });
      return Effect.gen(function* () {
        const decisions = yield* Decisions;
        yield* decisions.setConsent({ point: "riskAnnotation", projectId: null, source: "local" });
        const denied = { decision: "deny", reason: "policy" } as const;
        const annotated = yield* annotateApproval({
          request: { projectId: project, command: "ls" },
          policy: denied,
        });
        expect(annotated.policy).toBe(denied);
        expect(annotated.annotation.tier).toBe("safe");
      }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
    });
  });

  it.effect("narrows recalled facts through the registered narrower", () => {
    const model = makeFakeModel();
    model.replyWith({ memory_0: { value: "drop", confidence: 0.9 } });
    const fact = (id: string): MemoryItem => ({
      id,
      scope: "global",
      kind: "fact",
      content: id,
      provenance: "user_explicit",
      status: "active",
      originThreadId: null,
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    });
    return Effect.gen(function* () {
      const decisions = yield* Decisions;
      const narrow = yield* narrower;
      const input = { projectId: project, text: "Use pnpm?", facts: [fact("a"), fact("b")] };
      expect((yield* narrow(input)).map(({ id }) => id)).toEqual(["a", "b"]);
      yield* decisions.setConsent({ point: "memoryNarrowing", projectId: null, source: "local" });
      expect((yield* narrow(input)).map(({ id }) => id)).toEqual(["b"]);
    }).pipe(Effect.provide(layerDecisionsTest({ model, settings: { cmdeck: localModel } })));
  });

  it.effect("a scheduled task keeps its model unless a tier model is pinned", () => {
    const model = makeFakeModel();
    const requested = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
    const scheduled = {
      projectId: project,
      prompt: "hi",
      modelSelection: requested,
      schedule: { type: "interval", everyMs: 3_600_000 },
    } as Parameters<typeof routeScheduledTask>[0];
    return Effect.gen(function* () {
      expect(yield* routeScheduledTask(scheduled)).toEqual(requested);
      expect(model.prompts).toEqual([]);
    }).pipe(Effect.provide(layerDecisionsTest({ model })));
  });

  it.effect("a runtime without the decision service keeps today's behaviour", () =>
    Effect.gen(function* () {
      const requested = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
      expect(
        yield* routeScheduledTask({
          projectId: project,
          prompt: "hi",
          modelSelection: requested,
          schedule: { type: "interval", everyMs: 3_600_000 },
        } as Parameters<typeof routeScheduledTask>[0]),
      ).toBe(requested);
      expect(yield* decideWake(tick)).toBe("wake");
      const annotated = yield* annotateApproval({
        request: { projectId: null, command: "rm -rf /" },
        policy: "allow",
      });
      expect(annotated).toEqual({
        policy: "allow",
        annotation: { tier: "risky", reasons: ["recursive delete"] },
      });
    }),
  );
});
