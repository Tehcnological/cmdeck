import * as Layer from "effect/Layer";

import * as RemoteMcpTokens from "../auth/RemoteMcpTokens.ts";
import * as PublicAddressCheck from "../environment/PublicAddressCheck.ts";
import * as AuditLog from "./audit/AuditLog.ts";
import * as Notifications from "./notifications/Notifications.ts";

/**
 * Every fork service the server provides, in one place so `server.ts` carries a single fork line.
 * It sits above the orchestration layers, so a module may depend on anything the runtime builds.
 * ForkAlerts stays beside ServerSettings, which writes to it.
 */
export const layer = Layer.mergeAll(
  RemoteMcpTokens.layer,
  PublicAddressCheck.layer,
  // Notifications writes channel changes and delivery failures to the audit log.
  Notifications.layer.pipe(Layer.provideMerge(AuditLog.layer)),
);
