import * as Layer from "effect/Layer";

import * as RemoteMcpTokens from "../auth/RemoteMcpTokens.ts";
import * as PublicAddressCheck from "../environment/PublicAddressCheck.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ApprovalGate from "./approvalPolicy/ApprovalGate.ts";
import * as ApprovalPolicy from "./approvalPolicy/ApprovalPolicy.ts";
import * as AuditLog from "./audit/AuditLog.ts";
import * as Decisions from "./decisions/Decisions.ts";
import * as Notifications from "./notifications/Notifications.ts";
import * as MemoryStore from "./memory/MemoryStore.ts";
import * as TurnContext from "./memory/TurnContext.ts";
import * as CheckScripts from "./checkScripts/CheckScripts.ts";
import * as CheckScriptAlerts from "./checkScripts/alerts.ts";
import * as UsageAlerts from "./usageAlerts/UsageAlerts.ts";

/**
 * Every fork service the server provides, in one place so `server.ts` carries a single fork line.
 * It sits above the orchestration layers, so a module may depend on anything the runtime builds.
 * ForkAlerts stays beside ServerSettings, which writes to it.
 */
export const layer = Layer.mergeAll(
  RemoteMcpTokens.layer,
  PublicAddressCheck.layer,
  // The approval policy audits and alerts on each decline, usage alerts alert on thresholds,
  // check scripts report through alerts, and Notifications audits its own changes; all share
  // one Notifications.
  Layer.mergeAll(
    ApprovalPolicy.layer.pipe(Layer.provide(ProjectionStore.layer)),
    UsageAlerts.layer,
    CheckScriptAlerts.layer,
  ).pipe(Layer.provideMerge(Notifications.layer), Layer.provideMerge(AuditLog.layer)),
);

/**
 * Fork services orchestration reads, provided beneath it. They may depend only on what lies below
 * orchestration: settings, persistence and the project store.
 */
export const layerBeneathOrchestration = Layer.merge(
  Layer.mergeAll(TurnContext.layer, ApprovalGate.layer).pipe(
    Layer.provideMerge(MemoryStore.layer),
    // TurnContext narrows memory and the scheduler routes models through it.
    Layer.provideMerge(Decisions.layer),
    Layer.provide(ProjectionStore.layer),
  ),
  // The scheduler gates runs on it (WI-2.11).
  CheckScripts.layer,
);
