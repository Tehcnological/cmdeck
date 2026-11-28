import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { MilestoneEventType } from "../milestones.ts";

/**
 * A scheduled task that runs when a milestone happens (WI-2.13). It has no next run time; the
 * server folds a burst of matching milestones into one run, and runs started by event tasks never
 * trigger event tasks. Older clients drop these tasks from their list, a forward-compatible array.
 * Outcomes filter only events that have one; project ids pass workflow events, which have none.
 */
export const ScheduledTaskEventSchedule = Schema.Struct({
  type: Schema.Literal("event"),
  events: Schema.Array(MilestoneEventType).check(Schema.isMinLength(1)),
  outcomes: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).annotate({ description: "Such as failed. Omit for any." }),
  ),
  projectIds: Schema.optional(Schema.Array(ProjectId).annotate({ description: "Omit for any." })),
});
export type ScheduledTaskEventSchedule = typeof ScheduledTaskEventSchedule.Type;
