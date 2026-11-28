import type { MilestoneEventType } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";

import { Label } from "../components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import {
  EVENT_KIND_LABELS,
  EVENT_OUTCOME_LABELS,
  type EventProjectScope,
  type EventTriggerDraft,
  eventKindLabel,
} from "./eventTriggers.logic";

/** The "On event" choice in the scheduled task editor's schedule type group (WI-2.13). */
export function EventTriggerToggle() {
  return (
    <Toggle value="event">
      <T>On event</T>
    </Toggle>
  );
}

/** The event kinds, outcomes and project filter of an event-triggered scheduled task. */
export function EventTriggerFields<D extends { readonly eventTrigger: EventTriggerDraft }>({
  draft,
  setDraft,
}: {
  readonly draft: D;
  readonly setDraft: (update: (current: D) => D) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const trigger = draft.eventTrigger;
  const update = (patch: Partial<EventTriggerDraft>) =>
    setDraft((current) => ({ ...current, eventTrigger: { ...current.eventTrigger, ...patch } }));
  // Kinds an agent saved that the form does not offer stay visible, so they can be removed.
  const kinds = [
    ...EVENT_KIND_LABELS.map(([kind]) => kind),
    ...trigger.events.filter((kind) => !EVENT_KIND_LABELS.some(([offered]) => offered === kind)),
  ];
  const scopeLabels: Record<EventProjectScope, string> = {
    task: gt("This task's project"),
    any: gt("Any project"),
    custom: gt("Projects an agent chose"),
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>
          <T>Run when</T>
        </Label>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label={gt("Events that run this task")}
          value={[...trigger.events]}
          onValueChange={(values) => update({ events: values as MilestoneEventType[] })}
        >
          {kinds.map((kind) => (
            <Toggle key={kind} value={kind}>
              {eventKindLabel(kind, messages)}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-1.5">
        <Label className="flex items-baseline justify-between">
          <span>
            <T>Only with outcome</T>
          </span>
          <span className="font-normal text-2xs text-muted-foreground/80">
            <T>none picked: any</T>
          </span>
        </Label>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label={gt("Outcomes that run this task")}
          value={[...trigger.outcomes]}
          onValueChange={(values) => update({ outcomes: values as string[] })}
        >
          {EVENT_OUTCOME_LABELS.map(([outcome, label]) => (
            <Toggle key={outcome} value={outcome}>
              {messages(label)}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="scheduled-task-event-projects">
          <T>From</T>
        </Label>
        <Select
          value={trigger.projectScope}
          onValueChange={(value) => update({ projectScope: value as EventProjectScope })}
        >
          <SelectTrigger size="sm" id="scheduled-task-event-projects" className="w-auto">
            <SelectValue>{scopeLabels[trigger.projectScope]}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {(["task", "any"] as const).map((scope) => (
              <SelectItem key={scope} value={scope}>
                {scopeLabels[scope]}
              </SelectItem>
            ))}
            {trigger.customProjectIds.length > 0 ? (
              <SelectItem value="custom">{scopeLabels.custom}</SelectItem>
            ) : null}
          </SelectPopup>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        <T>
          Each event runs the prompt once, with the event's details after it; events that arrive
          within a few seconds share one run. Runs that event tasks start never trigger event tasks,
          so a task cannot set itself off.
        </T>
      </p>
    </div>
  );
}
