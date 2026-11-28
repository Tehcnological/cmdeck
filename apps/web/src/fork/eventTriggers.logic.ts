import {
  type MilestoneEventType,
  ProjectId,
  type ScheduledTaskEventSchedule,
  type ScheduledTaskSchedule,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

/** The project filter as the form offers it; "custom" keeps a list an agent saved. */
export type EventProjectScope = "task" | "any" | "custom";

export interface EventTriggerDraft {
  readonly events: ReadonlyArray<MilestoneEventType>;
  readonly outcomes: ReadonlyArray<string>;
  readonly projectScope: EventProjectScope;
  readonly customProjectIds: ReadonlyArray<ProjectId>;
}

export const EVENT_TRIGGER_DRAFT_DEFAULT: EventTriggerDraft = {
  events: ["thread.run_settled"],
  outcomes: [],
  projectScope: "task",
  customProjectIds: [],
};

/** The kinds the form offers. Others an agent saves still show, by their type name. */
export const EVENT_KIND_LABELS: ReadonlyArray<readonly [MilestoneEventType, string]> = [
  ["thread.run_settled", msg("A turn ends")],
  ["thread.needs_input", msg("An agent needs input")],
  ["pr.watch_wake", msg("A watched pull request wakes")],
  ["workflow.needs_input", msg("A workflow asks a question")],
  ["workflow.run_paused", msg("A workflow run pauses")],
  ["workflow.run_ended", msg("A workflow run ends")],
];

export const EVENT_OUTCOME_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["completed", msg("Completed")],
  ["failed", msg("Failed")],
  ["interrupted", msg("Interrupted")],
  ["cancelled", msg("Cancelled", { $context: "how a turn ended" })],
];

export function eventTriggerDraft(
  schedule: ScheduledTaskSchedule,
  projectId: string,
): EventTriggerDraft {
  if (schedule.type !== "event") return EVENT_TRIGGER_DRAFT_DEFAULT;
  const projectIds = schedule.projectIds;
  return {
    events: schedule.events,
    outcomes: schedule.outcomes ?? [],
    projectScope:
      projectIds === undefined
        ? "any"
        : projectIds.length === 1 && projectIds[0] === projectId
          ? "task"
          : "custom",
    customProjectIds: projectIds ?? [],
  };
}

export function eventTriggerDraftErrors(draft: EventTriggerDraft, resolve: MessageResolver = m) {
  return draft.events.length > 0
    ? []
    : [
        {
          title: resolve(msg("No event picked")),
          description: resolve(msg("Pick at least one event that runs this task.")),
        },
      ];
}

/** `projectId` is the task's, which "task" follows when the task moves. */
export function eventScheduleFromDraft(
  draft: EventTriggerDraft,
  projectId: string,
): ScheduledTaskEventSchedule | null {
  if (draft.events.length === 0) return null;
  const projectIds =
    draft.projectScope === "any"
      ? undefined
      : draft.projectScope === "task"
        ? [ProjectId.make(projectId)]
        : draft.customProjectIds;
  return {
    type: "event",
    events: draft.events,
    ...(draft.outcomes.length > 0 ? { outcomes: draft.outcomes } : {}),
    ...(projectIds === undefined ? {} : { projectIds }),
  };
}

export function eventKindLabel(kind: MilestoneEventType, resolve: MessageResolver = m): string {
  const label = EVENT_KIND_LABELS.find(([value]) => value === kind)?.[1];
  return label === undefined ? kind : resolve(label);
}

export function eventScheduleLabel(
  schedule: ScheduledTaskEventSchedule,
  resolve: MessageResolver = m,
): string {
  const events = schedule.events.map((kind) => eventKindLabel(kind, resolve)).join(", ");
  return resolve(msg("When: {events}", { events }));
}
