// Fork-only. This fork shares `<T3 home>/runtime/versions/<version>` with the official T3 Code, whose
// installers write the same layout and version numbers but never this marker.
export const FORK_RUNTIME_MARKER_FILE = ".t3code-fork";
export const FORK_RUNTIME_MARKER_CONTENTS = "t3code-fork\n";

/** Why an install or update refuses to reuse a complete runtime that lacks the marker. */
export const unmarkedRuntimeReason = (versionDir: string) =>
  `${versionDir} holds a T3 Code runtime this fork did not install, most likely the official T3 Code build of the same version. Delete that folder, then run the command again so this fork installs its own build.`;

/** The background service already runs such a runtime; it keeps running and only gets this alert. */
export const unmarkedActiveRuntimeAlert = (versionDir: string) =>
  `The background service runs ${versionDir}, which this fork did not install (most likely the official T3 Code). It was left running. To switch the service to this fork, stop it, delete that folder, and run \`t3 service install\` with this fork's t3.`;
