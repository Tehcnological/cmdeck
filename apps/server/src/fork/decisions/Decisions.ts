import {
  type DecisionConsent,
  type DecisionConsentSetInput,
  type DecisionConsentSource,
  type DecisionModelSetting,
  type DecisionPoint,
  DecisionsError,
  type DecisionsStatus,
  type ModelSelection,
  type ProjectId,
  resolveProjectProviderInstanceEnabled,
  type ScheduledTask,
  textGeneratorForSelection,
} from "@t3tools/contracts";
import type * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import {
  isPrivateNetworkHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@t3tools/shared/hostClassification";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGenerators from "../../textGeneration/TextGenerators.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import {
  type AutomationKind,
  type ModelRoute,
  modelRouting,
  type ModelRoutingInput,
} from "./points/modelRouting.ts";
import { AnswersReply, buildPrompt, validAnswers } from "./questions.ts";
import type { DecisionPointSpec } from "./spec.ts";

/** Who answered: the point's rule, or a model the consent allowed. */
export type DecisionSource = "rules" | DecisionConsentSource;

export interface Decided<A> {
  readonly value: A;
  readonly source: DecisionSource;
}

export interface DecisionContext {
  readonly projectId: ProjectId | null;
}

/**
 * Typed questions at fixed points, each answered by a deterministic rule unless the user consented
 * to a model for that point. It is never a security gate: callers enforce policy before and apart
 * from anything it returns.
 */
export class Decisions extends Context.Service<
  Decisions,
  {
    /** Never fails: a missing model, consent or valid answer leaves the rule's answer. */
    readonly decide: <I, A>(
      spec: DecisionPointSpec<I, A>,
      input: I,
      context: DecisionContext,
    ) => Effect.Effect<Decided<A>>;
    /** The model for a new thread an automation starts. Never fails. */
    readonly routeAutomation: (input: {
      readonly kind: AutomationKind;
      readonly projectId: ProjectId;
      readonly prompt: string;
      readonly requested: ModelSelection;
    }) => Effect.Effect<Decided<ModelRoute>>;
    /** The model a point may ask for a project now, or why it must keep to its rule. */
    readonly modelFor: (
      point: DecisionPoint,
      projectId: ProjectId | null,
    ) => Effect.Effect<ModelChoice, DecisionsError>;
    readonly status: Effect.Effect<DecisionsStatus, DecisionsError>;
    readonly setConsent: (input: DecisionConsentSetInput) => Effect.Effect<void, DecisionsError>;
  }
>()("t3/fork/decisions/Decisions") {}

/** On this machine, the local network or the tailnet: the places A5 counts as local inference. */
export const isLocalModelAddress = (baseUrl: string): boolean => {
  try {
    const host = new URL(baseUrl).hostname;
    return isPrivateNetworkHost(host) || isSharedAddressSpaceHost(host) || isTailnetHost(host);
  } catch {
    return false;
  }
};

// The runner reports this name in errors; decisions are not one of upstream's text operations.
const DECIDE_OPERATION = "decide" as TextGenerationOperations.Operation;

const ALL_PROJECTS = "";

interface ConsentRow {
  readonly point: DecisionPoint;
  readonly project_id: string;
  readonly source: DecisionConsentSource;
  readonly granted_at: string;
}

export type ModelChoice =
  | { readonly source: DecisionConsentSource; readonly model: DecisionModelSetting }
  | { readonly source: "rules"; readonly reason: string };

const isDecisionsError = Schema.is(DecisionsError);

const failed = (detail: string) => (cause: unknown) => new DecisionsError({ detail, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const textGenerators = yield* TextGenerators.TextGenerators;
  const providers = yield* ProviderRegistry.ProviderRegistry;

  const consentFor = Effect.fn("Decisions.consentFor")(function* (
    point: DecisionPoint,
    projectId: ProjectId | null,
  ) {
    const rows = yield* sql<ConsentRow>`
      SELECT point, project_id, source, granted_at FROM decision_consents
      WHERE point = ${point} AND project_id IN (${ALL_PROJECTS}, ${projectId ?? ALL_PROJECTS})`;
    // A project's own consent overrides the one for every project.
    const own = rows.find((row) => projectId !== null && row.project_id === projectId);
    return (own ?? rows.find((row) => row.project_id === ALL_PROJECTS))?.source;
  });

  const modelFor = Effect.fn("Decisions.modelFor")(function* (
    point: DecisionPoint,
    projectId: ProjectId | null,
  ) {
    const settings = yield* settingsService.getSettings;
    const model = settings.cmdeck.decisionModel;
    if (model === null) return { source: "rules", reason: "no model" } satisfies ModelChoice;
    const config = textGeneratorForSelection(settings, model.instanceId);
    if (config === undefined || !config.enabled) {
      return { source: "rules", reason: "model unavailable" } satisfies ModelChoice;
    }
    const consent = yield* consentFor(point, projectId);
    if (consent === undefined)
      return { source: "rules", reason: "no consent" } satisfies ModelChoice;
    const local = isLocalModelAddress(config.baseUrl);
    if (!local && consent !== "remote") {
      return { source: "rules", reason: "model not local" } satisfies ModelChoice;
    }
    return { source: local ? "local" : "remote", model } satisfies ModelChoice;
  });

  const ask = Effect.fn("Decisions.ask")(function* (
    model: DecisionModelSetting,
    state: string,
    questions: Parameters<typeof buildPrompt>[1],
  ) {
    const runner = yield* textGenerators.runner(model.instanceId);
    if (runner === undefined) return yield* Effect.fail("not a text generator");
    const reply = yield* runner({
      operation: DECIDE_OPERATION,
      cwd: "",
      prompt: buildPrompt(state, questions),
      outputSchema: AnswersReply,
      modelSelection: { instanceId: model.instanceId, model: model.model },
    });
    return validAnswers(questions, reply);
  });

  const decide = <I, A>(
    spec: DecisionPointSpec<I, A>,
    input: I,
    context: DecisionContext,
  ): Effect.Effect<Decided<A>> => {
    const ruled = spec.rule(input);
    const byRule: Decided<A> = { value: ruled, source: "rules" };
    return Effect.gen(function* () {
      const question = spec.ask(input, ruled);
      if (question === undefined || question.questions.length === 0) return byRule;
      const choice = yield* modelFor(spec.point, context.projectId);
      if (choice.source === "rules") return byRule;
      const answers = yield* ask(choice.model, question.state, question.questions).pipe(
        Effect.timeoutOption(spec.timeout),
      );
      if (Option.isNone(answers)) {
        yield* Effect.logInfo(`The ${spec.point} model timed out; its rule decided.`);
        return byRule;
      }
      return { value: spec.combine(input, ruled, answers.value), source: choice.source };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(`The ${spec.point} decision fell back to its rule.`, cause).pipe(
          Effect.as(byRule),
        ),
      ),
      Effect.withSpan(`Decisions.decide.${spec.point}`),
    );
  };

  const routeAutomation: Decisions["Service"]["routeAutomation"] = (input) => {
    const keep: Decided<ModelRoute> = {
      value: { tier: "medium", selection: input.requested, reason: "held" },
      source: "rules",
    };
    return Effect.gen(function* () {
      const settings = yield* settingsService.getSettings;
      const project = resolveProjectSettings(settings, input.projectId).settings;
      const routing: ModelRoutingInput = {
        kind: input.kind,
        prompt: input.prompt,
        requested: input.requested,
        tierModels: settings.cmdeck.routingTierModels,
        fallback: project.fallbackModelSelection,
        providers: yield* providers.getProviders,
        projectAllows: (instanceId) =>
          resolveProjectProviderInstanceEnabled(settings, input.projectId, instanceId),
        now: DateTime.toEpochMillis(yield* DateTime.now),
      };
      return yield* decide(modelRouting, routing, { projectId: input.projectId });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Model routing failed; the task keeps its model.", cause).pipe(
          Effect.as(keep),
        ),
      ),
    );
  };

  const status = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const model = settings.cmdeck.decisionModel;
    const config =
      model === null ? undefined : textGeneratorForSelection(settings, model.instanceId);
    const rows = yield* sql<ConsentRow>`
      SELECT point, project_id, source, granted_at FROM decision_consents
      ORDER BY point, project_id`;
    return {
      model:
        model === null
          ? null
          : { ...model, local: config !== undefined && isLocalModelAddress(config.baseUrl) },
      consents: rows.map((row): DecisionConsent => ({
        point: row.point,
        projectId: row.project_id === ALL_PROJECTS ? null : (row.project_id as ProjectId),
        source: row.source,
        grantedAt: row.granted_at,
      })),
    } satisfies DecisionsStatus;
  }).pipe(Effect.mapError(failed("Could not read the decision settings.")));

  const setConsent = Effect.fn("Decisions.setConsent")(
    function* (input: DecisionConsentSetInput) {
      if (input.source === "remote" && input.projectId === null) {
        return yield* new DecisionsError({
          detail: "A model API off this machine can only be allowed for one project at a time.",
        });
      }
      const projectId = input.projectId ?? ALL_PROJECTS;
      if (input.source === null) {
        yield* sql`DELETE FROM decision_consents
          WHERE point = ${input.point} AND project_id = ${projectId}`;
      } else {
        const grantedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`INSERT INTO decision_consents (point, project_id, source, granted_at)
          VALUES (${input.point}, ${projectId}, ${input.source}, ${grantedAt})
          ON CONFLICT (point, project_id) DO UPDATE SET
            source = excluded.source, granted_at = excluded.granted_at`;
      }
      yield* AuditLog.note({
        kind: input.source === null ? "decisions.consent.revoked" : "decisions.consent.granted",
        subject: input.point,
        detail: { projectId: input.projectId, source: input.source },
      });
    },
    Effect.mapError((error) =>
      isDecisionsError(error) ? error : failed("Could not save the consent.")(error),
    ),
  );

  return Decisions.of({
    decide,
    routeAutomation,
    modelFor: Effect.fn("Decisions.modelForPoint")(
      (point: DecisionPoint, projectId: ProjectId | null) => modelFor(point, projectId),
      Effect.mapError(failed("Could not read the decision settings.")),
    ),
    status,
    setConsent,
  });
});

export const layer = Layer.effect(Decisions, make);

const automationKind = (task: Pick<ScheduledTask, "schedule">): AutomationKind =>
  task.schedule.type === "webhook" ? "webhook" : "scheduled";

/**
 * The scheduler's one call: the model a scheduled task's new thread starts on. A runtime without
 * the decision service, such as a scheduler test, keeps the task's own.
 */
export const routeScheduledTask = (
  task: Pick<ScheduledTask, "projectId" | "prompt" | "modelSelection" | "schedule">,
): Effect.Effect<ModelSelection> =>
  Effect.serviceOption(Decisions).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(task.modelSelection),
        onSome: (decisions) =>
          decisions
            .routeAutomation({
              kind: automationKind(task),
              projectId: task.projectId,
              prompt: task.prompt,
              requested: task.modelSelection,
            })
            .pipe(Effect.map((decided) => decided.value.selection)),
      }),
    ),
  );
