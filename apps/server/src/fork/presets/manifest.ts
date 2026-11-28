import { CODE_REVIEW } from "./code-review.ts";
import { RESEARCH_LAB } from "./research-lab.ts";
import { TASK_RUNNER } from "./task-runner.ts";

export interface WorkflowPreset {
  readonly id: string;
  /** The file name it gets in the workflows folder. */
  readonly name: string;
  readonly title: string;
  /** The file's text, copied as is; installing approves exactly these bytes. */
  readonly source: string;
}

/** Workflow files CMDeck ships. A new one gets a row here and a case in `presets.test.ts`. */
export const PRESETS: ReadonlyArray<WorkflowPreset> = [TASK_RUNNER, RESEARCH_LAB, CODE_REVIEW];
