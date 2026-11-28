import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";
import { DecisionConsentSource } from "./decisions.ts";

/**
 * Opts one project in to lessons, or out with a null `source`. The source is the decision consent
 * for the `lessons` point: `local` reaches only a model API on this machine, the local network or
 * the tailnet; `remote` any configured one.
 */
export const LessonsProjectInput = Schema.Struct({
  projectId: ProjectId,
  source: Schema.NullOr(DecisionConsentSource),
});
export type LessonsProjectInput = typeof LessonsProjectInput.Type;
