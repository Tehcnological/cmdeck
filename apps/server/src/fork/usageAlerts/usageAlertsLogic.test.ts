import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { codexRateLimitsToLimits } from "../../provider/codexUsageLimits.ts";
import {
  alertableWindows,
  decideUsageAlerts,
  decideWindow,
  usageReadings,
  type UsageReading,
  type WindowState,
} from "./usageAlertsLogic.ts";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-11-27T12:00:00.000Z");
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const firstReset = iso(now + 5 * HOUR);
const secondReset = iso(now + 10 * HOUR);

describe("decideWindow", () => {
  // Each step feeds the state the step before kept, as the service does across refreshes.
  const steps: ReadonlyArray<{
    readonly name: string;
    readonly usedPercent: number;
    readonly resetsAt: string | null;
    readonly at: number;
    readonly crossed: number | null;
  }> = [
    { name: "below the threshold", usedPercent: 79, resetsAt: firstReset, at: now, crossed: null },
    { name: "crosses once", usedPercent: 81, resetsAt: firstReset, at: now, crossed: 80 },
    { name: "stays above", usedPercent: 85, resetsAt: firstReset, at: now, crossed: null },
    {
      name: "reset time jitters inside the window",
      usedPercent: 86,
      resetsAt: iso(now + 5 * HOUR + 1000),
      at: now,
      crossed: null,
    },
    {
      name: "new window, still above: tells again",
      usedPercent: 82,
      resetsAt: secondReset,
      at: now + 6 * HOUR,
      crossed: 80,
    },
    {
      name: "drops under the threshold",
      usedPercent: 3,
      resetsAt: secondReset,
      at: now + 6 * HOUR,
      crossed: null,
    },
    {
      name: "recrosses after the drop",
      usedPercent: 90,
      resetsAt: secondReset,
      at: now + 7 * HOUR,
      crossed: 80,
    },
  ];

  it("tells each crossing once per window period", () => {
    let stored: WindowState | undefined;
    const seen = steps.map((step) => {
      const result = decideWindow({
        usedPercent: step.usedPercent,
        resetsAt: step.resetsAt,
        percents: [80],
        stored,
        now: step.at,
      });
      stored = result.kept;
      return { name: step.name, crossed: result.crossed };
    });
    expect(seen).toEqual(steps.map(({ name, crossed }) => ({ name, crossed })));
  });

  it("tells the highest of several thresholds crossed in one step, and the rest stay told", () => {
    const jump = decideWindow({
      usedPercent: 96,
      resetsAt: firstReset,
      percents: [50, 80, 95],
      stored: undefined,
      now,
    });
    expect(jump).toEqual({ crossed: 95, kept: { resetsAt: firstReset, told: [50, 80, 95] } });
    expect(
      decideWindow({
        usedPercent: 100,
        resetsAt: firstReset,
        percents: [50, 80, 95, 100],
        stored: jump.kept,
        now,
      }).crossed,
    ).toBe(100);
  });

  it("starts a window without a reset time over only when usage falls back", () => {
    const first = decideWindow({
      usedPercent: 85,
      resetsAt: null,
      percents: [80],
      stored: undefined,
      now,
    });
    expect(first.crossed).toBe(80);
    const later = decideWindow({
      usedPercent: 88,
      resetsAt: null,
      percents: [80],
      stored: first.kept,
      now: now + 1000 * HOUR,
    });
    expect(later.crossed).toBeNull();
  });
});

const window = (id: string, usedPercent: number, resetsAt = firstReset) => ({
  id,
  kind: "weekly" as const,
  label: id,
  usedPercent,
  resetsAt,
});

describe("alertableWindows", () => {
  it("skips a seat-based Codex account's spent credit cap while its plan windows exist", () => {
    // The same reading codexUsageLimits.test.ts keeps usable for turns.
    const limits = codexRateLimitsToLimits({
      checkedAt: iso(now),
      snapshot: {
        limitId: "codex",
        planType: "team",
        rateLimitReachedType: null,
        primary: { usedPercent: 0, resetsAt: now / 1000 + 3600, windowDurationMins: 300 },
        secondary: { usedPercent: 14, resetsAt: now / 1000 + 86_400, windowDurationMins: 10080 },
        individualLimit: { remainingPercent: 0, resetsAt: now / 1000 + 30 * 86_400 },
      },
    });
    expect(limits.windows.some((w) => w.id === "individual" && w.usedPercent === 100)).toBe(true);
    expect(alertableWindows("codex", limits.windows, now).map((w) => w.id)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("keeps a Codex credit cap that is the only limit, and other drivers' windows of that id", () => {
    const individual = [window("individual", 90)];
    expect(alertableWindows("codex", individual, now)).toEqual(individual);
    const claude = [window("primary", 10), window("individual", 90)];
    expect(alertableWindows("claudeAgent", claude, now)).toEqual(claude);
  });

  it("skips a window whose reset has passed", () => {
    expect(alertableWindows("claudeAgent", [window("weekly", 95, iso(now - 1000))], now)).toEqual(
      [],
    );
  });
});

const provider = (
  instanceId: string,
  driver: string,
  usageLimits: ServerProviderUsageLimits | undefined,
  email?: string,
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: email === undefined ? { status: "authenticated" } : { status: "authenticated", email },
  checkedAt: iso(now),
  models: [],
  slashCommands: [],
  skills: [],
  ...(usageLimits === undefined ? {} : { usageLimits }),
});

describe("usageReadings", () => {
  it("names an account by its login, without keeping the login, and skips unread ones", () => {
    const limits = { checkedAt: iso(now), windows: [window("weekly", 50)] };
    const readings = usageReadings(
      [
        provider("claude", "claudeAgent", limits, "me@example.com"),
        provider("codex", "codex", limits),
        provider("cursor", "cursor", {
          ...limits,
          unavailable: { reason: "probeFailed" },
        }),
      ],
      [
        {
          id: UsageLimitSourceId.make("hub"),
          kind: "cliproxy",
          label: "Hub",
          checkedAt: iso(now),
          accounts: [
            {
              id: "claude-me.json",
              driver: ProviderDriverKind.make("claudeAgent"),
              email: "me@example.com",
              usageLimits: limits,
            },
          ],
        },
      ],
    );
    expect(readings.map((reading) => reading.accountKey)).toEqual([
      readings[0]!.accountKey,
      "instance:codex",
      readings[0]!.accountKey,
    ]);
    expect(readings[0]!.accountKey).toMatch(/^account:[0-9a-f]{32}$/);
  });
});

describe("decideUsageAlerts", () => {
  const reading = (accountKey: string, usedPercent: number): UsageReading => ({
    accountKey,
    accountLabel: "Claude",
    driver: "claudeAgent",
    windows: [{ id: "weekly", label: "Weekly", usedPercent, resetsAt: firstReset }],
  });

  it("tells one account read twice once, and each account on its own", () => {
    const first = decideUsageAlerts({
      readings: [reading("a", 82), reading("a", 82), reading("b", 90)],
      percents: [80],
      stored: new Map(),
      now,
    });
    expect(first.alerts).toEqual([
      {
        accountKey: "a",
        windowId: "weekly",
        title: "Claude: Weekly limit at 82%",
        body: "You have used 82% of the Weekly limit, past your 80% alert. It resets in 5h.",
      },
      expect.objectContaining({ accountKey: "b" }),
    ]);
    expect(first.changed.map(({ accountKey }) => accountKey)).toEqual(["a", "b"]);
  });
});
