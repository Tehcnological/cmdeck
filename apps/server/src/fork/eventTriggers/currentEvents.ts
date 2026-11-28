import type { ScheduledTask } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { type Batch, promptWithEvents } from "./matching.ts";

/**
 * The events behind the run in progress, set around `runNow`. A reference, so the scheduler reads
 * it without a typed dependency; elsewhere it is null and runs send their prompt unchanged.
 */
export class CurrentEvents extends Context.Reference<Batch | null>(
  "t3/fork/eventTriggers/CurrentEvents",
  { defaultValue: () => null },
) {}

/** The scheduler's hook: an event-triggered run sends its prompt with the events after it. */
export const withEvents = Effect.fnUntraced(function* (task: ScheduledTask | null) {
  const batch = yield* CurrentEvents;
  return task === null || batch === null
    ? task
    : { ...task, prompt: promptWithEvents(task.prompt, batch) };
});
