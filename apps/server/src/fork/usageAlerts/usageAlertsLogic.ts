// @effect-diagnostics nodeBuiltinImport:off -- a synchronous digest keeps account keys pure; Effect's Digest is a service.
// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/dashboard/handlers/plan_credit_alerts.py (Apache-2.0).
// Changes: one reading per limit window instead of one plan-credit reading; a window period ends
// when its stored reset time passes, not whenever the reset string changes; accounts come from
// provider and hub usage limits; state lives in SQLite instead of a JSON file.
import * as NodeCrypto from "node:crypto";

import {
  PROVIDER_DISPLAY_NAMES,
  type ServerProvider,
  type ServerProviderUsageWindow,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";

type AlertWindow = Pick<ServerProviderUsageWindow, "id" | "label" | "usedPercent" | "resetsAt">;

/** One account's limit windows, as read from a provider or a usage hub. */
export interface UsageReading {
  /** Stable across refreshes; carries no e-mail or user id. */
  readonly accountKey: string;
  readonly accountLabel: string;
  readonly driver: string | null;
  readonly windows: ReadonlyArray<AlertWindow>;
}

/** What was told for one window of one account. */
export interface WindowState {
  readonly resetsAt: string | null;
  readonly told: ReadonlyArray<number>;
}

export interface UsageAlert {
  readonly accountKey: string;
  readonly windowId: string;
  readonly title: string;
  readonly body: string;
}

const digest = (parts: ReadonlyArray<string | null>) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

/** An account named by its login is one account wherever it is read; otherwise by where it is read. */
const accountKey = (
  driver: string,
  email: string | undefined,
  workspaceId: string | undefined,
  fallback: string,
) => (email === undefined ? fallback : `account:${digest([driver, email, workspaceId ?? null])}`);

const driverName = (driver: string) =>
  PROVIDER_DISPLAY_NAMES[driver as ServerProvider["driver"]] ?? driver;

/** Every account with a current reading: provider instances, hub accounts and HTTP quota accounts. */
export function usageReadings(
  providers: ReadonlyArray<ServerProvider>,
  sources: ReadonlyArray<UsageLimitSourceSnapshot>,
): ReadonlyArray<UsageReading> {
  const readings: UsageReading[] = [];
  for (const provider of providers) {
    const limits = provider.usageLimits;
    if (!provider.enabled || limits === undefined || limits.unavailable) continue;
    readings.push({
      accountKey: accountKey(
        provider.driver,
        provider.auth.email,
        undefined,
        `instance:${provider.instanceId}`,
      ),
      accountLabel: provider.displayName?.trim() || driverName(provider.driver),
      driver: provider.driver,
      windows: limits.windows,
    });
  }
  for (const source of sources) {
    for (const account of source.accounts) {
      if (account.usageLimits.unavailable) continue;
      readings.push({
        accountKey: accountKey(
          account.driver,
          account.email,
          account.workspaceId,
          `hub:${source.id}:${account.id}:${account.workspaceId ?? ""}`,
        ),
        accountLabel: `${driverName(account.driver)} (${account.email ?? account.id})`,
        driver: account.driver,
        windows: account.usageLimits.windows,
      });
    }
    for (const account of source.quotaAccounts ?? []) {
      readings.push({
        accountKey: `http:${source.id}:${account.id}`,
        accountLabel: `${source.label} (${account.label})`,
        driver: null,
        windows: account.windows,
      });
    }
  }
  return readings;
}

/**
 * The windows that count for an account, with the eligibility `exhaustedUsageWindow` in
 * `@t3tools/shared/usageLimits` applies: a window whose reset has passed is stale, and a
 * seat-based Codex plan spends credits only past its plan windows, so its credit cap
 * (`individual`, often 0% left) does not count while those windows exist.
 */
export function alertableWindows<W extends AlertWindow>(
  driver: string | null,
  windows: ReadonlyArray<W>,
  now: number,
): ReadonlyArray<W> {
  const current = windows.filter((window) => {
    const resetsAt = Date.parse(window.resetsAt ?? "");
    return !Number.isFinite(resetsAt) || resetsAt > now;
  });
  if (driver !== "codex") return current;
  const hasPlanWindows = windows.some(
    (window) => window.id === "primary" || window.id === "secondary",
  );
  return hasPlanWindows ? current.filter((window) => window.id !== "individual") : current;
}

/**
 * The highest threshold newly crossed, if any, and the state to keep. A jump past several tells the
 * highest once; a period ends only when the stored reset passes (reset times jitter), and usage that
 * falls back under a told threshold makes it tellable again.
 */
export function decideWindow(input: {
  readonly usedPercent: number;
  readonly resetsAt: string | null;
  readonly percents: ReadonlyArray<number>;
  readonly stored: WindowState | undefined;
  readonly now: number;
}): { readonly crossed: number | null; readonly kept: WindowState } {
  const { usedPercent, percents, stored, now } = input;
  const ended =
    stored?.resetsAt != null &&
    Number.isFinite(Date.parse(stored.resetsAt)) &&
    Date.parse(stored.resetsAt) <= now;
  const told = (ended || stored === undefined ? [] : stored.told).filter((t) => t <= usedPercent);
  const crossed = percents.filter((p) => p <= usedPercent && !told.includes(p));
  const kept = {
    resetsAt: input.resetsAt,
    told: [...new Set([...told, ...crossed])].toSorted((a, b) => a - b),
  };
  return { crossed: crossed.length === 0 ? null : Math.max(...crossed), kept };
}

const formatDuration = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  const rest = minutes % 60;
  if (hours > 0) return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
};

/** Server-authored English, like other fork alerts. */
function alertText(
  reading: UsageReading,
  window: AlertWindow,
  threshold: number,
  now: number,
): { readonly title: string; readonly body: string } {
  const used = window.usedPercent;
  const shown = used >= 10 ? used.toFixed(0) : used.toFixed(1);
  const resetsAt = Date.parse(window.resetsAt ?? "");
  const reset = Number.isFinite(resetsAt) ? ` It resets in ${formatDuration(resetsAt - now)}.` : "";
  return {
    title: `${reading.accountLabel}: ${window.label} limit at ${shown}%`,
    body: `You have used ${shown}% of the ${window.label} limit, past your ${threshold}% alert.${reset}`,
  };
}

/** Alerts for every newly crossed window, and the window states that changed. */
export function decideUsageAlerts(input: {
  readonly readings: ReadonlyArray<UsageReading>;
  readonly percents: ReadonlyArray<number>;
  readonly stored: ReadonlyMap<string, WindowState>;
  readonly now: number;
}): {
  readonly alerts: ReadonlyArray<UsageAlert>;
  readonly changed: ReadonlyArray<{
    readonly accountKey: string;
    readonly windowId: string;
    readonly state: WindowState;
  }>;
} {
  const alerts: UsageAlert[] = [];
  const changed = new Map<
    string,
    { readonly accountKey: string; readonly windowId: string; readonly state: WindowState }
  >();
  const current = new Map(input.stored);
  for (const reading of input.readings) {
    for (const window of alertableWindows(reading.driver, reading.windows, input.now)) {
      const key = windowStateKey(reading.accountKey, window.id);
      const stored = current.get(key);
      const { crossed, kept } = decideWindow({
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt ?? null,
        percents: input.percents,
        stored,
        now: input.now,
      });
      if (stored === undefined || !sameState(stored, kept)) {
        current.set(key, kept);
        changed.set(key, { accountKey: reading.accountKey, windowId: window.id, state: kept });
      }
      if (crossed !== null) {
        alerts.push({
          accountKey: reading.accountKey,
          windowId: window.id,
          ...alertText(reading, window, crossed, input.now),
        });
      }
    }
  }
  return { alerts, changed: [...changed.values()] };
}

/** The account key and window id, which a NUL byte cannot appear inside. */
export const windowStateKey = (accountKey: string, windowId: string) =>
  `${accountKey}\u0000${windowId}`;

const sameState = (a: WindowState, b: WindowState) =>
  a.resetsAt === b.resetsAt &&
  a.told.length === b.told.length &&
  a.told.every((value, index) => value === b.told[index]);
