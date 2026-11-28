import type {
  DecisionConsentSource,
  DecisionsStatus,
  EnvironmentId,
  OrchestrationProjectShell,
  ProjectId,
} from "@t3tools/contracts";

/** What a project's lessons select shows: off, or the consent that opted it in. */
export type LessonChoice = "off" | DecisionConsentSource;

export const LESSON_CHOICES: ReadonlyArray<LessonChoice> = ["off", "local", "remote"];

export const lessonChoice = (status: DecisionsStatus | null, projectId: ProjectId): LessonChoice =>
  status?.consents.find((consent) => consent.point === "lessons" && consent.projectId === projectId)
    ?.source ?? "off";

/** Why an opted-in project may still not be read: no decision model, or one off this network. */
export const lessonsModelNote = (status: DecisionsStatus | null): "none" | "remote" | null =>
  status === null ? null : status.model === null ? "none" : status.model.local ? null : "remote";

/** This environment's projects, scratch ones aside, by title. */
export const lessonProjects = <
  P extends Pick<OrchestrationProjectShell, "id" | "title"> & {
    readonly environmentId: EnvironmentId;
    readonly isScratch?: true;
  },
>(
  projects: ReadonlyArray<P>,
  environmentId: EnvironmentId,
): ReadonlyArray<P> =>
  projects
    .filter((project) => project.environmentId === environmentId && project.isScratch !== true)
    .toSorted((left, right) => left.title.localeCompare(right.title));
