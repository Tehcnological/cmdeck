import type { EnvironmentId } from "@t3tools/contracts";

/** Where a palette row acts on workflows: the primary server when it runs them, as the Workflows page picks. */
export function workflowEnvironmentFor(
  primary: EnvironmentId | null,
  workflowIds: ReadonlyArray<EnvironmentId>,
): EnvironmentId | null {
  return primary !== null && workflowIds.includes(primary) ? primary : (workflowIds[0] ?? null);
}
