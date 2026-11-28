import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../../serverActivation.ts";
import * as Notifications from "../notifications/Notifications.ts";
import { APPROVAL_KINDS, ApprovalGate, feedbackFor, supportsFeedback } from "./ApprovalGate.ts";
import type { PolicyVerdict } from "./rules.ts";

/** The request a stored event shows waiting for an answer, if any. */
const pendingApprovalId = (event: OrchestrationV2DomainEvent): RuntimeRequestId | undefined => {
  if (event.type === "runtime-request.updated") {
    return event.payload.status === "pending" && APPROVAL_KINDS.has(event.payload.kind)
      ? event.payload.id
      : undefined;
  }
  if (event.type === "turn-item.updated" && event.payload.type === "approval_request") {
    return event.payload.status === "waiting" ? event.payload.requestId : undefined;
  }
  return undefined;
};

export class ApprovalPolicy extends Context.Service<
  ApprovalPolicy,
  {
    /**
     * Checks one waiting approval against the deny rules and declines it when one applies, for
     * requests nobody answers; an accept is gated where it is dispatched. Null when there is
     * nothing to decide. Never fails; a request it cannot check stays with the user, whose
     * accept the gate still checks.
     */
    readonly screen: (
      threadId: ThreadId,
      requestId: RuntimeRequestId,
    ) => Effect.Effect<PolicyVerdict | null>;
  }
>()("t3/fork/approvalPolicy/ApprovalPolicy") {}

const make = Effect.gen(function* () {
  const gate = yield* ApprovalGate;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const notifications = yield* Effect.serviceOption(Notifications.Notifications);

  const screen = Effect.fn("ApprovalPolicy.screen")(
    function* (threadId: ThreadId, requestId: RuntimeRequestId) {
      const context = yield* projections.getRuntimeResponseContext(threadId, requestId);
      const judgement = yield* gate.judge(threadId, context);
      if (judgement === null || context.request === undefined) return null;
      const { verdict, facts } = judgement;
      if (verdict.decision === "allow") return verdict;
      yield* orchestrator.dispatch({
        type: "runtime-request.respond",
        commandId: CommandId.make(`approval-policy:${requestId}`),
        threadId,
        requestId,
        decision: "decline",
        ...(supportsFeedback(context.request) ? { feedback: feedbackFor(verdict.reason) } : {}),
      });
      const thread = yield* gate.recordDecline({
        threadId,
        requestId,
        requestKind: context.request.kind,
        verdict,
        facts,
      });
      if (Option.isSome(notifications)) {
        yield* notifications.value.alert({
          id: `approval-policy:${requestId}`,
          title: "Approval declined by policy",
          body: `${thread.title ?? "A thread"}: declined because ${verdict.reason}.`,
          projectId: thread.projectId ?? undefined,
          threadId,
        });
      }
      return verdict;
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("The approval policy could not check a request; it stays with the user", {
        cause,
      }).pipe(Effect.as(null)),
    ),
  );

  return ApprovalPolicy.of({ screen });
});

/** Screens every approval as soon as it is stored. */
export const layer = Layer.effect(
  ApprovalPolicy,
  Effect.gen(function* () {
    const policy = yield* make;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        const requestId = pendingApprovalId(event);
        return requestId === undefined ? Effect.void : policy.screen(event.threadId, requestId);
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("approval policy stream failed", { cause })),
      ),
    );
    return policy;
  }),
);
