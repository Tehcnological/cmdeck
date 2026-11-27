import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it.each([
    // Weekdays at 09:00 London, across both 2026 daylight-saving changes.
    ["0 9 * * 1-5", "2026-03-26T09:00:00.000Z", "2026-03-27T09:00:00.000Z"],
    ["0 9 * * 1-5", "2026-03-27T09:00:00.000Z", "2026-03-30T08:00:00.000Z"],
    ["0 9 * * 1-5", "2026-03-30T08:00:00.000Z", "2026-03-31T08:00:00.000Z"],
    ["0 9 * * 1-5", "2026-10-23T08:00:00.000Z", "2026-10-26T09:00:00.000Z"],
    ["0 9 * * 1-5", "2026-10-26T09:00:00.000Z", "2026-10-27T09:00:00.000Z"],
    // 01:30 does not exist on the spring change, so it runs an hour later, at 02:30.
    ["30 1 * * *", "2026-03-28T23:00:00.000Z", "2026-03-29T01:30:00.000Z"],
    ["30 1 * * *", "2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"],
    // 01:30 happens twice on the autumn change; it runs once.
    ["30 1 * * *", "2026-10-24T23:00:00.000Z", "2026-10-25T00:30:00.000Z"],
    ["30 1 * * *", "2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"],
    // Both day fields restricted: either matches. Names and Sunday as 7.
    ["0 12 13 * fri", "2026-11-01T00:00:00.000Z", "2026-11-06T12:00:00.000Z"],
    ["0 12 10 * 5", "2026-11-06T12:00:00.000Z", "2026-11-10T12:00:00.000Z"],
    ["*/15 * * * 7", "2026-11-28T23:59:00.000Z", "2026-11-29T00:00:00.000Z"],
    ["0 0 29 feb *", "2026-03-01T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ])("runs %s after %s at %s", (expression, from, expected) => {
    const timeZone = expression === "0 0 29 feb *" ? "UTC" : "Europe/London";
    const next = nextScheduledRunAt(
      { type: "cron", expression, timeZone },
      DateTime.makeUnsafe(from),
    );
    expect(next === null ? null : DateTime.formatIso(DateTime.toUtc(next))).toBe(expected);
  });

  it("reads a cron schedule without a zone on the clock it is given", () => {
    const from = DateTime.makeZonedUnsafe("2026-07-01T10:00:00.000Z", {
      timeZone: "America/New_York",
    });
    const next = nextScheduledRunAt({ type: "cron", expression: "0 9 * * *" }, from);
    expect(next === null ? null : DateTime.formatIso(DateTime.toUtc(next))).toBe(
      "2026-07-01T13:00:00.000Z",
    );
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});
