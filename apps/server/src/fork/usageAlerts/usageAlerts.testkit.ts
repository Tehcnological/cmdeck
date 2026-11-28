import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as MilestoneHub from "../../milestones/MilestoneHub.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UsageLimitSources from "../../usage/UsageLimitSources.ts";
import * as AuditLog from "../audit/AuditLog.ts";
import * as Notifications from "../notifications/Notifications.ts";
import * as UsageAlerts from "./UsageAlerts.ts";

/**
 * UsageAlerts over a provider list the test sets, with real notifications and an in-memory
 * database. Readings change only through `providers`; call `check` to evaluate them.
 */
export const layerUsageAlertsTest = (options: {
  readonly providers: Ref.Ref<ReadonlyArray<ServerProvider>>;
  readonly usageAlertPercents?: ReadonlyArray<number>;
  readonly drivers?: ReadonlyArray<Notifications.NotificationChannelDriver>;
}) =>
  UsageAlerts.layer.pipe(
    Layer.provideMerge(Notifications.layerWithDrivers(options.drivers ?? [])),
    Layer.provideMerge(MilestoneHub.layer),
    Layer.provideMerge(AuditLog.layerService),
    Layer.provideMerge(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Ref.get(options.providers),
        streamChanges: Stream.empty,
      }),
    ),
    Layer.provideMerge(
      Layer.mock(UsageLimitSources.UsageLimitSources)({
        current: Effect.succeed([]),
        streamChanges: Stream.empty,
      }),
    ),
    Layer.provideMerge(
      ServerSettings.layerTest(
        options.usageAlertPercents === undefined
          ? {}
          : { cmdeck: { usageAlertPercents: options.usageAlertPercents } },
      ),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
    Layer.provideMerge(NodeCrypto.layer),
  );

const checkedAt = "2026-11-27T12:00:00.000Z";

/** A Claude instance whose weekly window, with no reset time, is this far used. */
export const claudeAtPercent = (usedPercent: number): ServerProvider => ({
  instanceId: ProviderInstanceId.make("claude"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt,
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt,
    windows: [{ id: "weekly", kind: "weekly", label: "Weekly", usedPercent }],
  },
});
