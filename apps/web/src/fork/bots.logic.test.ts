import type { BotProfile } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { liveBotThreadIds, scheduleForChoice } from "./bots.logic";

describe("scheduleForChoice", () => {
  it("turns the presets into scheduled-task schedules", () => {
    expect(scheduleForChoice("hourly", "")).toEqual({ type: "interval", everyMs: 3_600_000 });
    expect(scheduleForChoice("daily", "")).toEqual({ type: "fixed_time", timeOfDay: "09:00" });
    expect(scheduleForChoice("weekdays", "")).toEqual({
      type: "fixed_time",
      timeOfDay: "09:00",
      weekdays: [1, 2, 3, 4, 5],
    });
  });

  it("passes a valid cron expression through, trimmed", () => {
    expect(scheduleForChoice("cron", " 0 9 * * 1-5 ")).toEqual({
      type: "cron",
      expression: "0 9 * * 1-5",
    });
  });

  it("says why a cron expression is unusable", () => {
    const result = scheduleForChoice("cron", "every morning");
    expect("problem" in result && result.problem.length > 0).toBe(true);
  });
});

describe("liveBotThreadIds", () => {
  const bot = (threadId: string, status: BotProfile["status"]) =>
    ({ threadId, status }) as unknown as BotProfile;

  it("badges only live bots' threads", () => {
    const ids = liveBotThreadIds([bot("thread-a", "active"), bot("thread-b", "deleted")]);
    expect([...ids]).toEqual(["thread-a"]);
  });
});
