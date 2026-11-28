// Ported from agent-of-empires@e5cf0b9f388de560e5716184f5507d744a517f27 src/containers/runtime_base.rs
// (create_args), src/containers/container_interface.rs (docker_env_args) and
// src/session/config/container_config.rs (the .git overlay table) (MIT).
import type { SandboxRuntimeKind } from "@t3tools/contracts";

/** What each CLI can do; Apple `container` has no read-only mounts and no network-off mode. */
export const RUNTIME_TRAITS = {
  docker: { binary: "docker", readOnlyMounts: true, networkNone: true, remove: ["rm", "-f"] },
  apple: {
    binary: "container",
    readOnlyMounts: false,
    networkNone: false,
    remove: ["delete", "--force"],
  },
} as const satisfies Record<
  SandboxRuntimeKind,
  {
    binary: string;
    readOnlyMounts: boolean;
    networkNone: boolean;
    remove: ReadonlyArray<string>;
  }
>;

export const LABEL_THREAD = "cmdeck.thread";
export const LABEL_OWNER = "cmdeck.owner";
export const LABEL_BOOT = "cmdeck.boot";

export interface ContainerMount {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readOnly: boolean;
}

export interface RunSpec {
  readonly runtime: SandboxRuntimeKind;
  readonly name: string;
  readonly image: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly workdir: string;
  readonly mounts: ReadonlyArray<ContainerMount>;
  /** Passed by name (`-e KEY`), so the CLI copies each value from its own environment. */
  readonly envKeys: ReadonlyArray<string>;
  readonly network: string;
  readonly ociRuntime: string | null;
  readonly cpus: string | null;
  readonly memory: string | null;
  /** `uid:gid`, so files the agent writes stay the user's on a Linux host. */
  readonly user: string | null;
  readonly tty: boolean;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

// `--mount` is CSV: a field holding a comma or quote is quoted, with quotes doubled.
const csvField = (field: string) =>
  /[",]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;

/** `--mount` rather than `-v`: it never creates a missing source, and drive letters need no parsing. */
export function mountArg(mount: ContainerMount, readOnly: boolean): string {
  return [
    "type=bind",
    csvField(`source=${mount.hostPath}`),
    csvField(`target=${mount.containerPath}`),
    ...(readOnly ? ["readonly"] : []),
  ].join(",");
}

/**
 * One container per process, removed when it exits. A container is not a VM: it shares the host
 * kernel (Docker Desktop and Apple `container` add a VM of their own).
 */
export function runArgs(spec: RunSpec): Array<string> {
  const traits = RUNTIME_TRAITS[spec.runtime];
  const args = ["run", "--rm", "-i", ...(spec.tty ? ["-t"] : []), "--name", spec.name];
  const push = (flag: string, value: string) => args.push(flag, value);
  for (const [key, value] of Object.entries(spec.labels)) push("--label", `${key}=${value}`);
  push("-w", spec.workdir);
  for (const mount of spec.mounts) {
    push("--mount", mountArg(mount, mount.readOnly && traits.readOnlyMounts));
  }
  for (const key of spec.envKeys) push("-e", key);
  // Apple has no `none`; passing it anyway makes the run fail rather than start with a network.
  push("--network", spec.network);
  if (spec.ociRuntime !== null && spec.runtime === "docker") push("--runtime", spec.ociRuntime);
  if (spec.cpus !== null) push("--cpus", spec.cpus);
  if (spec.memory !== null) push("-m", spec.memory);
  if (spec.user !== null) push("--user", spec.user);
  args.push(spec.image, spec.command, ...spec.args);
  return args;
}

export function listArgs(runtime: SandboxRuntimeKind, owner: string): Array<string> {
  return runtime === "docker"
    ? [
        "ps",
        "-a",
        "--filter",
        `label=${LABEL_OWNER}=${owner}`,
        "--format",
        `{{.Names}}\t{{.Label "${LABEL_THREAD}"}}\t{{.Label "${LABEL_BOOT}"}}`,
      ]
    : ["list", "--all", "--format", "json"];
}

export function removeArgs(
  runtime: SandboxRuntimeKind,
  names: ReadonlyArray<string>,
): Array<string> {
  return [...RUNTIME_TRAITS[runtime].remove, ...names];
}

export interface ListedContainer {
  readonly name: string;
  readonly threadId: string;
  readonly boot: string;
}

/** This server's containers from `listArgs` output; Apple has no label filter, so it filters here. */
export function parseList(
  runtime: SandboxRuntimeKind,
  stdout: string,
  owner: string,
): Array<ListedContainer> {
  if (runtime === "docker") {
    return stdout
      .split("\n")
      .map((line) => line.trim().split("\t"))
      .filter((fields) => fields.length === 3 && fields[0] !== "")
      .map(([name = "", threadId = "", boot = ""]) => ({ name, threadId, boot }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const listed: Array<ListedContainer> = [];
  for (const entry of parsed) {
    const configuration: unknown = entry?.configuration;
    if (typeof configuration !== "object" || configuration === null) continue;
    const id: unknown = Reflect.get(configuration, "id");
    const labels: unknown = Reflect.get(configuration, "labels");
    if (typeof id !== "string" || typeof labels !== "object" || labels === null) continue;
    const label = (key: string) => {
      const value: unknown = Reflect.get(labels, key);
      return typeof value === "string" ? value : "";
    };
    if (label(LABEL_OWNER) !== owner) continue;
    listed.push({ name: id, threadId: label(LABEL_THREAD), boot: label(LABEL_BOOT) });
  }
  return listed;
}

/** Where a host path appears inside the container: the same path, or `/c/...` for a Windows drive path. */
export function containerPathFor(hostPath: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return hostPath;
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(hostPath);
  if (drive === null) return hostPath.replaceAll("\\", "/");
  const rest = (drive[2] ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return `/${drive[1]?.toLowerCase()}${rest === "" ? "" : `/${rest}`}`;
}

export interface GitLayout {
  /** The repository's common dir (`.git`, or the main checkout's for a linked worktree). */
  readonly commonDir: string;
  /** The worktree's own admin dir; equals `commonDir` for the main checkout. */
  readonly adminDir: string;
  /** The worktree's `.git` file, when it is a file pointing elsewhere. */
  readonly dotGitFile: string | null;
}

export interface ProtectedGitPath {
  readonly path: string;
  readonly kind: "file" | "dir";
  /** Created before mounting: a missing bind source would fail, and an empty one is harmless. */
  readonly create: boolean;
  /** Mounted read-write over a protected parent: the thread's own worktree admin dir. */
  readonly writable?: true;
}

/**
 * Paths host-side git would execute from or follow: config (`core.sshCommand`, `core.fsmonitor`,
 * credential helpers), hooks, and the files that point a worktree at its git dir. Writable from
 * the container, they would let code inside run on the host the next time the user runs git.
 */
export function gitProtectedPaths(
  layout: GitLayout,
  join: (...parts: ReadonlyArray<string>) => string,
): Array<ProtectedGitPath> {
  const paths: Array<ProtectedGitPath> = [
    { path: join(layout.commonDir, "config"), kind: "file", create: true },
    { path: join(layout.commonDir, "hooks"), kind: "dir", create: true },
    { path: join(layout.commonDir, "config.worktree"), kind: "file", create: true },
    // Another worktree's commondir, or a submodule's config and hooks, also run on the host.
    { path: join(layout.commonDir, "worktrees"), kind: "dir", create: true },
    { path: join(layout.commonDir, "modules"), kind: "dir", create: true },
  ];
  if (layout.adminDir !== layout.commonDir) {
    paths.push(
      { path: layout.adminDir, kind: "dir", create: false, writable: true },
      { path: join(layout.adminDir, "config.worktree"), kind: "file", create: true },
      { path: join(layout.adminDir, "commondir"), kind: "file", create: false },
      { path: join(layout.adminDir, "gitdir"), kind: "file", create: false },
    );
  }
  if (layout.dotGitFile !== null) {
    paths.push({ path: layout.dotGitFile, kind: "file", create: false });
  }
  return paths;
}

const FORWARDED_PREFIXES = ["ANTHROPIC_", "CLAUDE_CODE_", "OPENAI_", "T3CODE_"];
const FORWARDED_NAMES = ["TERM", "COLORTERM", "LANG", "LC_ALL"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The variables a container gets: provider credentials, the thread marker, terminal basics and the
 * recipe's own list. Everything else in the host environment (AWS keys, tokens, PATH) stays out.
 */
export function forwardedEnvKeys(
  env: Readonly<Record<string, string | undefined>>,
  extra: ReadonlyArray<string>,
): Array<string> {
  const wanted = new Set(extra.map((name) => name.trim()).filter((name) => ENV_NAME.test(name)));
  return Object.keys(env)
    .filter(
      (key) =>
        env[key] !== undefined &&
        ENV_NAME.test(key) &&
        (wanted.has(key) ||
          FORWARDED_NAMES.includes(key) ||
          FORWARDED_PREFIXES.some((prefix) => key.startsWith(prefix))),
    )
    .toSorted();
}

const LOGIN_SHELL = "command -v bash >/dev/null 2>&1 && exec bash -l || exec sh -l";

/** The host's executable path means nothing inside the image: run its name from the image's PATH. */
export function containerCommand(
  name: string,
  command: string,
  args: ReadonlyArray<string>,
): { readonly command: string; readonly args: ReadonlyArray<string> } {
  if (name === "terminal") return { command: "/bin/sh", args: ["-c", LOGIN_SHELL] };
  // The host may run Claude from a script (npm's cli.js) or a Windows exe; the image has `claude`.
  if (name === "claude") return { command: "claude", args };
  const base = command.split(/[\\/]/).at(-1) ?? command;
  return { command: base.replace(/\.(exe|cmd|bat)$/i, ""), args };
}

/** Only the local socket or named pipe; a TCP endpoint would run the agent on another machine. */
export function isLocalDockerEndpoint(host: string): boolean {
  return host.startsWith("unix://") || host.startsWith("npipe://");
}

/** Docker's OCI runtime names from `docker info --format '{{json .Runtimes}}'`. */
export function parseDockerRuntimes(stdout: string): Array<string> {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === "object" && parsed !== null ? Object.keys(parsed).toSorted() : [];
  } catch {
    return [];
  }
}

/** Apple `container` needs macOS 26 (Darwin 25) on Apple silicon. */
export function appleContainerHostReason(
  platform: NodeJS.Platform,
  arch: string,
  release: string,
): string | null {
  if (platform !== "darwin") return "Apple container runs only on macOS.";
  if (arch !== "arm64") return "Apple container needs a Mac with Apple silicon.";
  const major = Number.parseInt(release.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < 25) return "Apple container needs macOS 26 or later.";
  return null;
}
