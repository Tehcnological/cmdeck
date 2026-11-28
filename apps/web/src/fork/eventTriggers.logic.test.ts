import { ProjectId, type ScheduledTaskEventSchedule } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EVENT_TRIGGER_DRAFT_DEFAULT,
  eventScheduleFromDraft,
  eventScheduleLabel,
  eventTriggerDraft,
  eventTriggerDraftErrors,
} from "./eventTriggers.logic";

const stored = (fields: Partial<ScheduledTaskEventSchedule> = {}): ScheduledTaskEventSchedule => ({
  type: "event",
  events: ["thread.run_settled", "pr.watch_wake"],
  outcomes: ["failed"],
  ...fields,
});

describe("event trigger drafts", () => {
  it("a task's own project follows the task when it moves", () => {
    const draft = eventTriggerDraft(
      stored({ projectIds: [ProjectId.make("project:a")] }),
      "project:a",
    );
    expect(draft.projectScope).toBe("task");
    expect(eventScheduleFromDraft(draft, "project:b")).toEqual({
      ...stored(),
      projectIds: ["project:b"],
    });
  });

  it("no project filter reads as any project and saves without one", () => {
    const draft = eventTriggerDraft(stored(), "project:a");
    expect(draft.projectScope).toBe("any");
    expect(eventScheduleFromDraft(draft, "project:a")).toEqual(stored());
  });

  it("keeps a project list an agent saved", () => {
    const projectIds = [ProjectId.make("project:x"), ProjectId.make("project:y")];
    const draft = eventTriggerDraft(stored({ projectIds }), "project:a");
    expect(draft.projectScope).toBe("custom");
    expect(eventScheduleFromDraft(draft, "project:a")?.projectIds).toEqual(projectIds);
  });

  it("drops an empty outcome filter and refuses a trigger with no event", () => {
    const draft = { ...EVENT_TRIGGER_DRAFT_DEFAULT, projectScope: "any" as const };
    expect(eventScheduleFromDraft(draft, "project:a")).toEqual({
      type: "event",
      events: ["thread.run_settled"],
    });
    const empty = { ...draft, events: [] };
    expect(eventScheduleFromDraft(empty, "project:a")).toBeNull();
    expect(eventTriggerDraftErrors(empty)).toHaveLength(1);
    expect(eventTriggerDraftErrors(draft)).toEqual([]);
  });

  it("another schedule type opens with the default trigger", () => {
    expect(eventTriggerDraft({ type: "interval", everyMs: 60_000 }, "project:a")).toBe(
      EVENT_TRIGGER_DRAFT_DEFAULT,
    );
  });

  it("labels kinds it offers and names the others by type", () => {
    expect(
      eventScheduleLabel(stored({ events: ["thread.run_settled", "thread.guest_request"] })),
    ).toBe("When: A turn ends, thread.guest_request");
  });
});
