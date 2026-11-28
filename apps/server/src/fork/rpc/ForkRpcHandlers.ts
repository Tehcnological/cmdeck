import {
  AuditLogError,
  CMDECK_RPC_VERSION,
  DecisionsError,
  CMDECK_WS_METHODS,
  ForkWsRpcGroup,
  WorkflowTrustError,
  NotificationChannelError,
  SandboxError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { WorkflowDefinitions } from "../../workflows/WorkflowRuntime.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import { Decisions } from "../decisions/Decisions.ts";
import { MemoryEmbeddings } from "../memory/MemoryEmbeddings.ts";
import { installPreset } from "../presets/install.ts";
import { ContainerSandbox } from "../sandbox/ContainerSandbox.ts";
import { WorkflowTrust } from "../workflowTrust/WorkflowTrust.ts";
import * as Notifications from "../notifications/Notifications.ts";
import * as MemoryRpc from "../memory/MemoryRpc.ts";

/** Spread into the server's WS handlers; each fork module adds its methods here. */
export const make = Effect.gen(function* () {
  // Optional so upstream's ws tests, which build the handlers without fork services, still compile.
  const audit = yield* Effect.serviceOption(AuditLog.AuditLog);
  const trust = yield* Effect.serviceOption(WorkflowTrust);
  const definitions = yield* Effect.serviceOption(WorkflowDefinitions);
  const unavailable = Effect.fail(new AuditLogError({}));
  const noTrust = Effect.fail(new WorkflowTrustError({ reason: "Workflows are not available." }));
  const notifications = yield* Effect.serviceOption(Notifications.Notifications);
  const noNotifications = Effect.fail(new NotificationChannelError({}));
  const decisions = yield* Effect.serviceOption(Decisions);
  const noDecisions = Effect.fail(
    new DecisionsError({ detail: "The decision service is not available." }),
  );
  const memory = yield* MemoryRpc.make;
  const embeddings = yield* Effect.serviceOption(MemoryEmbeddings);
  const sandbox = yield* Effect.serviceOption(ContainerSandbox);
  const noSandbox = Effect.fail(
    new SandboxError({ detail: "Containers are not available on this server." }),
  );
  return ForkWsRpcGroup.of({
    [CMDECK_WS_METHODS.status]: () => Effect.succeed({ version: CMDECK_RPC_VERSION }),
    [CMDECK_WS_METHODS.auditList]: (input) =>
      Option.isSome(audit) ? audit.value.list(input) : unavailable,
    [CMDECK_WS_METHODS.auditVerify]: () =>
      Option.isSome(audit) ? audit.value.verify : unavailable,
    [CMDECK_WS_METHODS.workflowTrustPending]: () =>
      Option.isSome(trust) ? Effect.map(trust.value.pending, (files) => ({ files })) : noTrust,
    [CMDECK_WS_METHODS.workflowTrustApprove]: (input) =>
      Option.isSome(trust) ? Effect.as(trust.value.approve(input.path, input.sha256), {}) : noTrust,
    [CMDECK_WS_METHODS.workflowPresetInstall]: (input) =>
      Option.isSome(trust) && Option.isSome(definitions)
        ? installPreset(trust.value, definitions.value, input.id)
        : noTrust,
    [CMDECK_WS_METHODS.notificationChannelsList]: () =>
      Option.isSome(notifications) ? notifications.value.listChannels : noNotifications,
    [CMDECK_WS_METHODS.notificationChannelsSetEnabled]: (input) =>
      Option.isSome(notifications) ? notifications.value.setChannelEnabled(input) : noNotifications,
    [CMDECK_WS_METHODS.notificationChannelsRemove]: (input) =>
      Option.isSome(notifications)
        ? notifications.value.removeChannel(input.channelId)
        : noNotifications,
    [CMDECK_WS_METHODS.notificationsSubscribeAlerts]: () =>
      Option.isSome(notifications)
        ? Stream.unwrap(notifications.value.subscribeAlerts)
        : Stream.empty,
    [CMDECK_WS_METHODS.decisionsStatus]: () =>
      Option.isSome(decisions) ? decisions.value.status : noDecisions,
    [CMDECK_WS_METHODS.decisionsSetConsent]: (input) =>
      Option.isSome(decisions) ? decisions.value.setConsent(input) : noDecisions,
    [CMDECK_WS_METHODS.memoryList]: memory.list,
    [CMDECK_WS_METHODS.memoryRevisions]: (input) => memory.revisions(input.itemId),
    [CMDECK_WS_METHODS.memoryEdit]: memory.edit,
    [CMDECK_WS_METHODS.memoryRevert]: memory.revert,
    [CMDECK_WS_METHODS.memoryPreviewEdit]: memory.previewEdit,
    [CMDECK_WS_METHODS.memoryApplyEdit]: memory.applyEdit,
    [CMDECK_WS_METHODS.memoryRemember]: memory.remember,
    [CMDECK_WS_METHODS.memoryThreadMode]: (input) => memory.threadMode(input.threadId),
    [CMDECK_WS_METHODS.memorySetThreadMode]: memory.setThreadMode,
    [CMDECK_WS_METHODS.memoryInjections]: (input) => memory.injections(input.threadId),
    [CMDECK_WS_METHODS.memoryEmbeddingsStatus]: () =>
      Option.isSome(embeddings)
        ? embeddings.value.status
        : Effect.succeed({
            mode: "keyword" as const,
            embedder: null,
            embedded: 0,
            total: 0,
            checkedAt: null,
          }),
    [CMDECK_WS_METHODS.sandboxStatus]: (input) =>
      Option.isSome(sandbox) ? sandbox.value.status(input) : noSandbox,
    [CMDECK_WS_METHODS.sandboxConfigure]: (input) =>
      Option.isSome(sandbox) ? sandbox.value.configure(input, "user") : noSandbox,
  });
});
