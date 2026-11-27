import { WorkflowTrustError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { WorkflowDefinitions } from "../../workflows/WorkflowRuntime.ts";
import type { WorkflowTrust } from "../workflowTrust/WorkflowTrust.ts";
import { PRESETS, type WorkflowPreset } from "./manifest.ts";

/** Copies a preset into the workflows folder with its bytes approved, through the editor's save. */
export const installPreset = Effect.fn("WorkflowPresets.install")(function* (
  trust: WorkflowTrust["Service"],
  definitions: WorkflowDefinitions["Service"],
  id: string,
  presets: ReadonlyArray<WorkflowPreset> = PRESETS,
) {
  const preset = presets.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    return yield* new WorkflowTrustError({ reason: `There is no preset named ${id}.` });
  }
  const folder = yield* definitions.read;
  if (folder.single) {
    return yield* new WorkflowTrustError({
      reason: "This server reads its workflows from one file, so a preset cannot be added.",
    });
  }
  const existing = folder.files.find((file) => file.name === preset.name);
  if (existing !== undefined && existing.source !== preset.source) {
    return yield* new WorkflowTrustError({
      reason: `${preset.name} already exists in the workflows folder. Rename or remove it first.`,
    });
  }
  // Approved before it is written, so the reload that follows the write loads it.
  yield* trust.record(folder.directory, preset.name, preset.source, "preset");
  if (existing !== undefined) return { changed: false, problems: [] };
  return yield* definitions.save(preset.name, preset.source);
});
