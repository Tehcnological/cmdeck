import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  parseCronExpression,
  type ScheduledTaskSchedule,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "event") return null;
  if (schedule.type === "once") {
    const runAt = DateTime.make(schedule.runAt);
    return Option.isSome(runAt) &&
      DateTime.toEpochMillis(runAt.value) > DateTime.toEpochMillis(from)
      ? runAt.value
      : null;
  }
  if (schedule.type === "interval") {
    // Intervals advance elapsed time, including across daylight-saving changes.
    return DateTime.addDuration(from, Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS));
  }
  if (schedule.type === "cron") return nextCronRunAt(schedule, from);

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(from, { days: offset }), {
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(from)) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(candidate).weekDay)) continue;
    return candidate;
  }
  return null;
}

// Long enough for a February 29 that falls eight years after the last one, as around 2100.
const CRON_SEARCH_DAYS = 8 * 366;

/**
 * Wall-clock times in the schedule's zone. A time skipped by a daylight-saving change runs as far
 * past it as the clocks moved (01:30 becomes 02:30); a time that happens twice runs once, at the first.
 */
function nextCronRunAt(
  schedule: Extract<ScheduledTaskSchedule, { type: "cron" }>,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  const cron = parseCronExpression(schedule.expression);
  const zone =
    schedule.timeZone === undefined
      ? Option.some(DateTime.isZoned(from) ? from.zone : DateTime.zoneMakeLocal())
      : DateTime.zoneMakeNamed(schedule.timeZone);
  if (typeof cron === "string" || Option.isNone(zone)) return null;
  const timeZone = zone.value;
  const fromMs = DateTime.toEpochMillis(from);
  const start = DateTime.toParts(DateTime.setZone(from, timeZone));
  const wallTime = (year: number, month: number, day: number, hour = 0, minute = 0) =>
    DateTime.makeZonedUnsafe(
      { year, month, day, hour, minute },
      { timeZone, adjustForTimeZone: true },
    );
  // UTC as a plain calendar: it has no gaps, so stepping days and reading weekdays is exact.
  const startDay = DateTime.makeUnsafe({ year: start.year, month: start.month, day: start.day });
  for (let offset = 0; offset <= CRON_SEARCH_DAYS; offset += 1) {
    const { year, month, day, weekDay } = DateTime.toPartsUtc(
      DateTime.add(startDay, { days: offset }),
    );
    if (!cron.months.includes(month)) continue;
    const onDayOfMonth = cron.daysOfMonth.includes(day);
    const onDayOfWeek = cron.daysOfWeek.includes(weekDay);
    const dayMatches =
      cron.anyDayOfMonth || cron.anyDayOfWeek
        ? onDayOfMonth && onDayOfWeek
        : onDayOfMonth || onDayOfWeek;
    if (!dayMatches) continue;
    // On a day whose offset changes, a shifted time can land before an earlier listed one.
    const steady =
      DateTime.zonedOffset(wallTime(year, month, day)) ===
      DateTime.zonedOffset(wallTime(year, month, day, 23, 59));
    let best: DateTime.Zoned | null = null;
    for (const hour of cron.hours) {
      for (const minute of cron.minutes) {
        const candidate = wallTime(year, month, day, hour, minute);
        const candidateMs = DateTime.toEpochMillis(candidate);
        if (candidateMs <= fromMs) continue;
        if (steady) return candidate;
        if (best === null || candidateMs < DateTime.toEpochMillis(best)) best = candidate;
      }
    }
    if (best !== null) return best;
  }
  return null;
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "interval") {
    return b.type === "interval" && a.everyMs === b.everyMs;
  }
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "event") return b.type === "event";
  if (a.type === "cron") {
    return (
      b.type === "cron" &&
      a.expression.trim().split(/\s+/).join(" ") === b.expression.trim().split(/\s+/).join(" ") &&
      a.timeZone === b.timeZone
    );
  }
  if (a.type === "once") return b.type === "once" && Date.parse(a.runAt) === Date.parse(b.runAt);
  if (b.type !== "fixed_time") return false;
  // Compare parsed times so padded-hour edits do not reschedule pending runs.
  const aTime = parseTimeOfDay(a.timeOfDay);
  const bTime = parseTimeOfDay(b.timeOfDay);
  return (
    aTime !== null &&
    bTime !== null &&
    aTime.hour === bTime.hour &&
    aTime.minute === bTime.minute &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays)
  );
}

const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;

export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time" && schedule.type !== "cron") return false;
  return DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt) > MISSED_FIXED_TIME_GRACE_MS;
}
