import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray } from "./baseSchemas.ts";
import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  ScheduledTask,
  ScheduledTaskListResult,
  ScheduledTaskSchedule,
  ScheduledTaskUpsertSchedule,
} from "./scheduledTask.ts";

const decodeSchedule = Schema.decodeUnknownSync(ScheduledTaskSchedule);
const decodeUpsertSchedule = Schema.decodeUnknownSync(ScheduledTaskUpsertSchedule);
const decodeList = Schema.decodeUnknownSync(ScheduledTaskListResult);
// The list as an official app built before cron decodes it.
const decodePreCronList = Schema.decodeUnknownSync(
  Schema.Struct({
    ...ScheduledTaskListResult.fields,
    tasks: ForwardCompatibleArray(
      Schema.Struct({
        ...ScheduledTask.fields,
        schedule: Schema.Union(
          ScheduledTaskSchedule.members.filter(
            (member) => !Schema.is(member)({ type: "cron", expression: "0 9 * * *" }),
          ),
        ),
      }),
    ),
  }),
);

describe("ScheduledTaskSchedule", () => {
  it("keeps legacy sub-minute persisted schedules readable", () => {
    expect(
      decodeSchedule({
        type: "interval",
        everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
      }),
    ).toEqual({
      type: "interval",
      everyMs: MIN_SCHEDULED_TASK_INTERVAL_MS - 1,
    });
  });

  it("accepts a one-time run only with an offset", () => {
    for (const runAt of ["2026-11-03T09:00Z", "2026-11-03T09:00:00.000-08:00"]) {
      expect(decodeUpsertSchedule({ type: "once", runAt })).toEqual({ type: "once", runAt });
    }
    for (const runAt of [
      "2026-11-03T09:00",
      "2026-13-03T09:00Z",
      "2026-02-30T09:00Z",
      "9999-12-31T23:30-01:00",
      "0000-01-01T00:00+00:01",
      "tomorrow",
    ]) {
      expect(() => decodeUpsertSchedule({ type: "once", runAt })).toThrow();
    }
  });
});

it.each(["literal", " ", "\t\n", "{{body.bad", "{{unknown.field}}"])(
  "rejects invalid dedupe template %s",
  (replayKey) => {
    expect(() => decodeUpsertSchedule({ type: "webhook", dedupe: { replayKey } })).toThrow();
    expect(() =>
      decodeUpsertSchedule({ type: "webhook", dedupe: { coalesceKey: replayKey } }),
    ).toThrow();
  },
);
describe("webhook filters", () => {
  const accepts = (filters: unknown) => {
    try {
      decodeUpsertSchedule({ type: "webhook", filters });
      return true;
    } catch {
      return false;
    }
  };

  it("rejects empty or unknown paths, unknown ops, and values that do not fit the op", () => {
    expect(accepts([{ path: "", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "  ", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "request", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "header.x-github-event", op: "exists" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: "opened" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "in", value: [] }])).toBe(false);
    for (const value of ["", " opened", "opened ", "a,b"]) {
      expect(accepts([{ path: "body.action", op: "in", value: [value] }])).toBe(false);
    }
    expect(accepts([{ path: "body.label.name", op: "in", value: ["needs review"] }])).toBe(true);
    expect(accepts([{ path: "body.action", op: "equals" }])).toBe(false);
    expect(accepts([{ path: "body.action", op: "matches", value: "^opened$" }])).toBe(false);
  });
});

describe("cron schedules", () => {
  const rejection = (schedule: unknown) => {
    try {
      decodeUpsertSchedule(schedule);
      return null;
    } catch (error) {
      return String(error);
    }
  };

  it("accepts five-field expressions with lists, ranges, steps and names", () => {
    for (const expression of ["0 9 * * 1-5", "*/15 8-18 * * mon-fri", "0 0 1,15 jan,jul *"]) {
      expect(rejection({ type: "cron", expression, timeZone: "Europe/London" })).toBeNull();
    }
    expect(rejection({ type: "cron", expression: "0 9 * * 7" })).toBeNull();
  });

  it("rejects invalid expressions and zones with a readable reason", () => {
    expect(rejection({ type: "cron", expression: "0 9 * *" })).toContain("five fields");
    expect(rejection({ type: "cron", expression: "60 9 * * *" })).toContain(
      'The minute field "60" is not valid.',
    );
    expect(rejection({ type: "cron", expression: "0 9 * * 5-1" })).toContain("day-of-week");
    expect(rejection({ type: "cron", expression: "0 9 * * */0" })).toContain("day-of-week");
    expect(rejection({ type: "cron", expression: "0 0 31 2 *" })).toContain("never runs");
    expect(
      rejection({ type: "cron", expression: "0 9 * * *", timeZone: "Europe/Atlantis" }),
    ).toContain("IANA time zone");
  });

  it("drops cron rows for a client that predates them without failing the list", () => {
    const task = (id: string, schedule: unknown) => ({
      id,
      title: "Review",
      prompt: "Review the open pull requests.",
      enabled: true,
      schedule,
      projectId: "project:test",
      threadId: null,
      workspaceStrategy: { type: "root" },
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdBy: "user",
      creationSource: "web",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: "never",
      lastRunError: null,
      runCount: 0,
    });
    const list = {
      tasks: [
        task("task:interval", { type: "interval", everyMs: 60_000 }),
        task("task:cron", { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/London" }),
      ],
    };
    expect(decodePreCronList(list).tasks.map((decoded) => decoded.id)).toEqual(["task:interval"]);
    expect(decodeList(list).tasks.map((decoded) => decoded.id)).toEqual([
      "task:interval",
      "task:cron",
    ]);
  });
});
