// Fork-only. The official T3 Code writes the same `runtime/versions/<version>` layout and version
// numbers but never this marker, so a shared or copied data folder cannot run its build as ours.
export const FORK_RUNTIME_MARKER_FILE = ".cmdeck";
export const FORK_RUNTIME_MARKER_CONTENTS = "cmdeck\n";

/** Why an install or update refuses to reuse a complete runtime that lacks the marker. */
export const unmarkedRuntimeReason = (versionDir: string) =>
  `${versionDir} holds a T3 Code runtime this fork did not install, most likely the official T3 Code build of the same version. Delete that folder, then run the command again so this fork installs its own build.`;

/** The background service already runs such a runtime; it keeps running and only gets this alert. */
export const unmarkedActiveRuntimeAlert = (versionDir: string) =>
  `The background service runs ${versionDir}, which this fork did not install (most likely the official T3 Code). It was left running. To switch the service to this fork, stop it, delete that folder, and run \`cmdeck service install\`.`;
