import * as Layer from "effect/Layer";

import * as RemoteMcpTokens from "../auth/RemoteMcpTokens.ts";
import * as PublicAddressCheck from "../environment/PublicAddressCheck.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as AgentDiscipline from "./agentDiscipline/AgentDiscipline.ts";
import * as SecretResolverLayer from "../secrets/SecretResolver.ts";
import * as ApprovalGate from "./approvalPolicy/ApprovalGate.ts";
import * as ApprovalPolicy from "./approvalPolicy/ApprovalPolicy.ts";
import * as AuditLog from "./audit/AuditLog.ts";
import * as Decisions from "./decisions/Decisions.ts";
import * as Notifications from "./notifications/Notifications.ts";
import * as MemoryEmbeddings from "./memory/MemoryEmbeddings.ts";
import * as MemoryStore from "./memory/MemoryStore.ts";
import * as MessagePins from "./messagePins/MessagePins.ts";
import * as TurnContext from "./memory/TurnContext.ts";
import * as WorkLedger from "./workLedger/WorkLedger.ts";
import * as CheckScripts from "./checkScripts/CheckScripts.ts";
import * as CheckScriptAlerts from "./checkScripts/alerts.ts";
import * as UsageAlerts from "./usageAlerts/UsageAlerts.ts";
import * as Heartbeat from "./monitoring/Heartbeat.ts";
import * as MonitorGate from "./monitoring/MonitorGate.ts";
import * as MonitorLoops from "./monitoring/MonitorLoops.ts";
import * as Layers from "./layers.ts";

/**
 * Every fork service the server provides, in one place so `server.ts` carries a single fork line.
 * It sits above the orchestration layers, so a module may depend on anything the runtime builds.
 * A module whose layer needs nothing from its neighbours lists it in `layers.ts` instead.
 * ForkAlerts stays beside ServerSettings, which writes to it.
 */
export const layer = Layer.mergeAll(
  RemoteMcpTokens.layer,
  PublicAddressCheck.layer,
  // The approval policy audits and alerts on each decline, usage alerts alert on thresholds,
  // check scripts report through alerts, the heartbeat alerts on health changes, and
  // Notifications audits its own changes; all share one Notifications. Quiet turns suppress it.
  Layer.mergeAll(
    ApprovalPolicy.layer.pipe(Layer.provide(ProjectionStore.layer)),
    UsageAlerts.layer,
    CheckScriptAlerts.layer,
    Heartbeat.layer,
  ).pipe(
    Layer.provideMerge(Notifications.layer),
    Layer.provideMerge(MonitorLoops.suppressionLayer),
    Layer.provideMerge(AuditLog.layer),
  ),
  MessagePins.layer.pipe(Layer.provide(ProjectionStore.layer)),
  ...Object.values(Layers),
);

/**
 * Fork services orchestration reads, provided beneath it. They may depend only on what lies below
 * orchestration: settings, persistence and the project store.
 */
/**
 * Below provider hydration, which builds the Claude adapters and keeps that context: their subagent
 * hooks read agent discipline from here. Layers memoize by reference, so this is the instance
 * `layerBeneathOrchestration` provides too.
 */
export const belowProviders = <A1, E1, R1, A2, E2, R2>(
  settings: Layer.Layer<A1, E1, R1>,
  persistence: Layer.Layer<A2, E2, R2>,
) =>
  AgentDiscipline.layer.pipe(
    Layer.provide(ProjectionStore.layer),
    Layer.provide(Layer.merge(settings, persistence)),
  );

export const layerBeneathOrchestration = Layer.merge(
  Layer.mergeAll(TurnContext.layer, ApprovalGate.layer).pipe(
    Layer.provideMerge(MemoryStore.layer),
    // TurnContext adds the working rules; the adapters, delegate_task and the PR watch enforce them.
    Layer.provideMerge(AgentDiscipline.layer),
    Layer.provideMerge(WorkLedger.layer),
    // Inert until `cmdeck.memoryEmbedder` names a local inference server.
    Layer.provideMerge(MemoryEmbeddings.layer.pipe(Layer.provide(SecretResolverLayer.layer))),
    // TurnContext narrows memory and the scheduler routes models through it.
    Layer.provideMerge(Decisions.layer),
    Layer.provide(ProjectionStore.layer),
  ),
  // The scheduler gates runs on it (WI-2.11), and monitor loops decide right after it (WI-2.12).
  MonitorGate.checkScriptsLayer.pipe(
    Layer.provide(CheckScripts.layer),
    Layer.provideMerge(MonitorGate.layer),
  ),
);
