import {
  type BotProfile,
  parseCronExpression,
  type ScheduledTaskUpsertSchedule,
  type ThreadId,
} from "@t3tools/contracts";

export type BotScheduleChoice = "hourly" | "daily" | "weekdays" | "cron";

const HOUR_MS = 60 * 60 * 1000;
const MORNING = "09:00";
const WEEKDAYS = [1, 2, 3, 4, 5];

/** The schedule a choice in the bot form stands for, or why the cron text is unusable. */
export const scheduleForChoice = (
  choice: BotScheduleChoice,
  cron: string,
): ScheduledTaskUpsertSchedule | { readonly problem: string } => {
  switch (choice) {
    case "hourly":
      return { type: "interval", everyMs: HOUR_MS };
    case "daily":
      return { type: "fixed_time", timeOfDay: MORNING };
    case "weekdays":
      return { type: "fixed_time", timeOfDay: MORNING, weekdays: WEEKDAYS };
    case "cron": {
      const expression = cron.trim();
      const parsed = parseCronExpression(expression);
      return typeof parsed === "string" ? { problem: parsed } : { type: "cron", expression };
    }
  }
};

/** Threads that belong to a live bot, for the sidebar badge. */
export const liveBotThreadIds = (bots: ReadonlyArray<BotProfile>): ReadonlySet<ThreadId> =>
  new Set(bots.filter((bot) => bot.status === "active").map((bot) => bot.threadId));
