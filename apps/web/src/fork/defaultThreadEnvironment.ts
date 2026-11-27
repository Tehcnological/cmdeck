import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  isPickableProjectMember,
  selectGroupDefaultProject,
  selectProjectGroupingSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, type ScopedProjectRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getClientSettings } from "../hooks/useSettings";
import {
  type ChatThreadActionContext,
  startNewThreadFromContext as startNewThreadFromContextOn,
} from "../lib/chatThreadActions";
import { readLocalStorageValue, useLocalStorage } from "../hooks/useLocalStorage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects } from "../state/entities";
import { environmentSummaries } from "../state/presentation";

/** Saved on this device only: each client picks its own machine for new threads. */
const DEFAULT_THREAD_ENVIRONMENT_STORAGE_KEY = "cmdeck:default-thread-environment:v1";
const makeStorageSchema = () => Schema.NullOr(EnvironmentId);
let storageSchema: ReturnType<typeof makeStorageSchema> | null = null;
// Built on first use: the new-thread handler's tests import this module with contracts mocked.
const defaultThreadEnvironmentSchema = () => (storageSchema ??= makeStorageSchema());

export function useDefaultThreadEnvironmentId() {
  return useLocalStorage(
    DEFAULT_THREAD_ENVIRONMENT_STORAGE_KEY,
    null,
    defaultThreadEnvironmentSchema(),
  );
}

function readDefaultThreadEnvironmentId(): EnvironmentId | null {
  return readLocalStorageValue(
    DEFAULT_THREAD_ENVIRONMENT_STORAGE_KEY,
    null,
    defaultThreadEnvironmentSchema(),
  );
}

export interface DefaultEnvironmentInput {
  readonly preferredEnvironmentId: EnvironmentId | null;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly groupingSettings: ProjectGroupingSettings;
}

/**
 * The same project on the default environment when that environment is connected and has it;
 * otherwise the project as given, so a new thread never lands on a machine nobody chose.
 */
export function resolveDefaultEnvironmentProjectRef(
  projectRef: ScopedProjectRef,
  input: DefaultEnvironmentInput,
): ScopedProjectRef {
  const preferred = input.preferredEnvironmentId;
  if (preferred === null || projectRef.environmentId === preferred) return projectRef;
  if (!input.connectedEnvironmentIds.includes(preferred)) return projectRef;
  const project = input.projects.find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.id === projectRef.projectId,
  );
  if (!project) return projectRef;
  // Scratch ("No project") threads group across machines, as in the sidebar.
  const keyOf = (candidate: EnvironmentProject) =>
    deriveLogicalProjectKeyFromSettings(candidate, input.groupingSettings, {
      groupScratchProjects: true,
    });
  const logicalKey = keyOf(project);
  const member = selectGroupDefaultProject(
    input.projects.filter(
      (candidate) =>
        candidate.environmentId === preferred &&
        isPickableProjectMember(candidate) &&
        keyOf(candidate) === logicalKey,
    ),
  );
  return member ? scopeProjectRef(member.environmentId, member.id) : projectRef;
}

function readDefaultEnvironmentInput(): DefaultEnvironmentInput {
  return {
    preferredEnvironmentId: readDefaultThreadEnvironmentId(),
    connectedEnvironmentIds: appAtomRegistry.get(environmentSummaries.connectedEnvironmentIdsAtom),
    projects: readProjects(),
    groupingSettings: selectProjectGroupingSettings(getClientSettings()),
  };
}

/** For entry points that choose a project but not a machine: the sidebar, palette and shortcut. */
export function preferDefaultThreadEnvironment(projectRef: ScopedProjectRef): ScopedProjectRef;
export function preferDefaultThreadEnvironment(
  projectRef: ScopedProjectRef | null,
): ScopedProjectRef | null;
export function preferDefaultThreadEnvironment(
  projectRef: ScopedProjectRef | null,
): ScopedProjectRef | null {
  return projectRef === null
    ? null
    : resolveDefaultEnvironmentProjectRef(projectRef, readDefaultEnvironmentInput());
}

/**
 * Upstream's "New thread" (sidebar button, shortcut, palette row), started on the default
 * environment. Callers import this in place of the `lib/chatThreadActions` export.
 */
export function startNewThreadFromContext(context: ChatThreadActionContext): Promise<boolean> {
  return startNewThreadFromContextOn({
    ...context,
    handleNewThread: (projectRef) =>
      context.handleNewThread(preferDefaultThreadEnvironment(projectRef)),
  });
}

/**
 * Whether an unsent draft missed the default environment because it is offline, so the composer can
 * say where the thread starts instead. A machine the user or load balancing chose is not a miss.
 */
export function defaultEnvironmentIsUnavailable(
  draft: {
    readonly environmentId: EnvironmentId;
    readonly environmentSelection?: "auto" | "manual";
  },
  input: Pick<DefaultEnvironmentInput, "preferredEnvironmentId" | "connectedEnvironmentIds">,
): boolean {
  const preferred = input.preferredEnvironmentId;
  return (
    preferred !== null &&
    draft.environmentId !== preferred &&
    draft.environmentSelection === undefined &&
    !input.connectedEnvironmentIds.includes(preferred)
  );
}
