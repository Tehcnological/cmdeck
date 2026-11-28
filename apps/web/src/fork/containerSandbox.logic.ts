import type { SandboxMount, SandboxRecipe, SandboxStatus } from "@t3tools/contracts";

const READ_ONLY_SUFFIX = ":ro";

/** One host path per line; a trailing `:ro` mounts it read-only. Blank lines are dropped. */
export function parseMounts(text: string): Array<SandboxMount> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) =>
      line.endsWith(READ_ONLY_SUFFIX) && line.length > READ_ONLY_SUFFIX.length
        ? { hostPath: line.slice(0, -READ_ONLY_SUFFIX.length), readOnly: true }
        : { hostPath: line, readOnly: false },
    );
}

function formatMounts(mounts: ReadonlyArray<SandboxMount>): string {
  return mounts
    .map((mount) => (mount.readOnly ? `${mount.hostPath}${READ_ONLY_SUFFIX}` : mount.hostPath))
    .join("\n");
}

/** Names separated by spaces, commas or lines, deduplicated in order. */
export function parseEnvNames(text: string): Array<string> {
  return [...new Set(text.split(/[\s,]+/).filter((name) => name !== ""))];
}

export interface RecipeForm {
  readonly runtime: SandboxRecipe["runtime"];
  readonly ociRuntime: string;
  readonly image: string;
  readonly network: string;
  readonly cpus: string;
  readonly memory: string;
  readonly mounts: string;
  readonly env: string;
}

export function formFromRecipe(recipe: SandboxRecipe): RecipeForm {
  return {
    runtime: recipe.runtime,
    ociRuntime: recipe.ociRuntime ?? "",
    image: recipe.image,
    network: recipe.network,
    cpus: recipe.cpus ?? "",
    memory: recipe.memory ?? "",
    mounts: formatMounts(recipe.mounts),
    env: recipe.env.join(" "),
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export function recipeFromForm(form: RecipeForm): SandboxRecipe {
  return {
    runtime: form.runtime,
    ociRuntime: form.runtime === "docker" ? orNull(form.ociRuntime) : null,
    image: form.image.trim(),
    network: form.network.trim() === "" ? "none" : form.network.trim(),
    cpus: orNull(form.cpus),
    memory: orNull(form.memory),
    mounts: parseMounts(form.mounts),
    env: parseEnvNames(form.env),
  };
}

/** Runtimes other than Docker's default, which the recipe can pick (gVisor shows as `runsc`). */
export function optionalOciRuntimes(status: SandboxStatus): Array<string> {
  const docker = status.runtimes.find((runtime) => runtime.kind === "docker");
  return (docker?.ociRuntimes ?? []).filter(
    (name) => name !== "runc" && name !== "io.containerd.runc.v2",
  );
}

export type ThreadContainerAction = "run-in-container" | "run-on-host" | "follow-project";

/**
 * The palette rows for the active thread: nothing until a container image is set, then a way in
 * and a way out, plus a way back to the project's choice once the thread has its own.
 */
export function threadContainerActions(status: SandboxStatus | null): Array<ThreadContainerAction> {
  if (status === null || status.thread === null || status.recipe.image === "") return [];
  const actions: Array<ThreadContainerAction> = [
    status.thread.sandboxed ? "run-on-host" : "run-in-container",
  ];
  if (status.thread.mode !== null) actions.push("follow-project");
  return actions;
}
