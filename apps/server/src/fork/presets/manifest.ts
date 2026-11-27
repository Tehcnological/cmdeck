export interface WorkflowPreset {
  readonly id: string;
  /** The file name it gets in the workflows folder. */
  readonly name: string;
  readonly title: string;
  /** The file's text, copied as is; installing approves exactly these bytes. */
  readonly source: string;
}

/** Workflow files CMDeck ships. Presets arrive with their own work items (WI-2.01, 2.03, 2.20). */
export const PRESETS: ReadonlyArray<WorkflowPreset> = [];
