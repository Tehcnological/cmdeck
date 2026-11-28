import * as Schema from "effect/Schema";

import { ProjectId } from "../baseSchemas.ts";

/**
 * A folder or file indexed for `knowledge_search`. `notes` is the project's notes folder: a folder
 * inside the project, edited in the file editor like any project file.
 */
export const KnowledgeSourceKind = Schema.Literals(["folder", "file", "notes"]);
export type KnowledgeSourceKind = typeof KnowledgeSourceKind.Type;

export const KnowledgeIndexState = Schema.Literals(["pending", "indexing", "ready", "error"]);
export type KnowledgeIndexState = typeof KnowledgeIndexState.Type;

export const KnowledgeSource = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  kind: KnowledgeSourceKind,
  /** The resolved absolute path the server indexes. */
  path: Schema.String,
  state: KnowledgeIndexState,
  files: Schema.Number,
  chunks: Schema.Number,
  /** Files left out by the size caps or because they are not text. Excluded paths are not counted. */
  skipped: Schema.Number,
  indexedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
});
export type KnowledgeSource = typeof KnowledgeSource.Type;

export const KnowledgeListInput = Schema.Struct({ projectId: ProjectId });
export type KnowledgeListInput = typeof KnowledgeListInput.Type;

export const KnowledgeAddSourceInput = Schema.Struct({
  projectId: ProjectId,
  kind: KnowledgeSourceKind,
  /** Absolute, or relative to the project folder. A notes folder must be inside the project. */
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
});
export type KnowledgeAddSourceInput = typeof KnowledgeAddSourceInput.Type;

export const KnowledgeSourceInput = Schema.Struct({ sourceId: Schema.String });
export type KnowledgeSourceInput = typeof KnowledgeSourceInput.Type;

export class KnowledgeError extends Schema.TaggedError<KnowledgeError>()("KnowledgeError", {
  message: Schema.String,
}) {}
