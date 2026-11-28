// @effect-diagnostics nodeBuiltinImport:off -- lstat and a link-refusing copy need node:fs.
// Fork-only. Each container commits into a private git dir CMDeck makes; the host's .git never
// enters the container, and the host imports the agent's commits back through a clean copy.
import * as NodeFS from "node:fs";

import { SandboxError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../../processRunner.ts";
import type { ContainerMount } from "./argv.ts";

/** Where the container sees its private git dir and the host's objects (read-only). */
const CONTAINER_GIT_DIR = "/cmdeck/git";
const CONTAINER_HOST_OBJECTS = "/cmdeck/host-objects";
const BRANCH = "refs/heads/cmdeck";
const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface PrivateGitPaths {
  readonly workspace: string;
  /** The container's git dir, rebuilt at each agent launch. */
  readonly privateDir: string;
  /** A clean, CMDeck-written repository the host fetches from. */
  readonly quarantineDir: string;
  /** An empty directory the host's .git is covered with, read-only. */
  readonly coverDir: string;
  /** Never mounted: host git runs hooks from here, and there are none. */
  readonly hooksDir: string;
}

const refuse = (detail: string) => Effect.fail(new SandboxError({ detail }));

const lstat = (target: string) =>
  Effect.sync(() => {
    try {
      return NodeFS.lstatSync(target);
    } catch {
      return null;
    }
  });

const configFor = (head: string, bare: boolean) =>
  head.length === 64
    ? `[core]\n\trepositoryformatversion = 1\n\tbare = ${bare}\n[extensions]\n\tobjectformat = sha256\n`
    : `[core]\n\trepositoryformatversion = 0\n\tbare = ${bare}\n`;

/**
 * Whether the worktree's volume ignores case: then `.GIT` is `.git`, and the container could write
 * the host's `.git` through the worktree mount whatever covers it. Tests on such a volume stub it.
 */
export const CaseInsensitiveWorkspace = Context.Reference<
  (workspace: string) => Effect.Effect<boolean>
>("t3/fork/sandbox/CaseInsensitiveWorkspace", {
  defaultValue: () => (workspace) =>
    Effect.map(lstat(`${workspace}/.GIT`), (entry) => entry !== null),
});

export const make = Effect.gen(function* () {
  const caseInsensitive = yield* CaseInsensitiveWorkspace;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  /** Host git with nothing a repository's config can make it run. */
  const git = (paths: PrivateGitPaths, args: ReadonlyArray<string>) =>
    runner
      .run({
        command: "git",
        args: [
          "-c",
          "core.fsmonitor=false",
          "-c",
          `core.hooksPath=${paths.hooksDir}`,
          "-c",
          "core.sshCommand=false",
          ...args,
        ],
        cwd: paths.workspace,
        // Added to the server's own environment.
        env: { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
        timeout: "2 minutes",
      })
      .pipe(
        Effect.flatMap((result) =>
          result.code === 0
            ? Effect.succeed(result.stdout)
            : refuse(
                `git ${args.find((arg) => !arg.startsWith("-")) ?? ""} failed: ${result.stderr.trim()}`,
              ),
        ),
        Effect.catchTags({
          ProcessSpawnError: () => refuse("git is not installed on this machine."),
          ProcessStdinError: () => refuse("git could not be run."),
          ProcessOutputLimitError: () => refuse("git printed too much."),
          ProcessReadError: () => refuse("git could not be read."),
          ProcessTimeoutError: () => refuse("git took too long."),
        }),
      );

  const writeFile = (file: string, text: string) =>
    fileSystem.makeDirectory(path.dirname(file), { recursive: true }).pipe(
      Effect.andThen(fileSystem.writeFileString(file, text)),
      Effect.mapError((cause) => new SandboxError({ detail: "Could not write git files.", cause })),
    );

  const reset = (dir: string) =>
    fileSystem.remove(dir, { recursive: true }).pipe(
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.void : Effect.fail(error),
      }),
      Effect.mapError((cause) => new SandboxError({ detail: "Could not clear git files.", cause })),
    );

  const hostRepository = Effect.fn("PrivateGit.hostRepository")(function* (paths: PrivateGitPaths) {
    if (yield* caseInsensitive(paths.workspace)) {
      return yield* refuse(
        "This worktree is on a case-insensitive volume, so a container could reach its .git. Put the project on a case-sensitive volume to run it in a container.",
      );
    }
    const dotGit = yield* lstat(path.join(paths.workspace, ".git"));
    if (dotGit === null || dotGit.isSymbolicLink()) {
      return yield* refuse("Only the root of a git repository or worktree can run in a container.");
    }
    if ((yield* lstat(path.join(paths.workspace, ".gitmodules"))) !== null) {
      return yield* refuse("Repositories with submodules cannot run in a container yet.");
    }
    const [commonDir = "", head = ""] = (yield* git(paths, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "HEAD",
    ]))
      .trim()
      .split(/\r?\n/);
    if (!OBJECT_ID.test(head)) return yield* refuse("The branch has no commit to start from.");
    return { objects: path.join(commonDir, "objects"), head, dotGitIsDir: dotGit.isDirectory() };
  });

  /** The thread's commit on its own branch, the host's objects as an alternate, a fresh index. */
  const seed = Effect.fn("PrivateGit.seed")(function* (
    paths: PrivateGitPaths,
    host: { readonly objects: string; readonly head: string },
  ) {
    yield* reset(paths.privateDir);
    yield* writeFile(path.join(paths.privateDir, "HEAD"), `ref: ${BRANCH}\n`);
    yield* writeFile(path.join(paths.privateDir, BRANCH), `${host.head}\n`);
    yield* writeFile(path.join(paths.privateDir, "config"), configFor(host.head, false));
    const alternates = path.join(paths.privateDir, "objects", "info", "alternates");
    yield* writeFile(alternates, `${host.objects}\n`);
    yield* git(paths, [
      `--git-dir=${paths.privateDir}`,
      `--work-tree=${paths.workspace}`,
      "read-tree",
      "HEAD",
    ]);
    // Inside, the host's objects appear read-only at a fixed path.
    yield* writeFile(alternates, `${CONTAINER_HOST_OBJECTS}\n`);
  });

  /**
   * Gives the container its git dir and returns the mounts and environment for it. `fresh` (an
   * agent launch) rebuilds it; a terminal shares the agent's and builds one only when there is none.
   */
  const prepare = Effect.fn("PrivateGit.prepare")(function* (
    paths: PrivateGitPaths,
    containerPath: (hostPath: string) => string,
    fresh: boolean,
  ) {
    const host = yield* hostRepository(paths);
    yield* Effect.forEach([paths.coverDir, paths.hooksDir], (dir) =>
      fileSystem.makeDirectory(dir, { recursive: true }),
    ).pipe(
      Effect.mapError((cause) => new SandboxError({ detail: "Could not prepare git.", cause })),
    );
    const seeded = yield* fileSystem
      .exists(path.join(paths.privateDir, "HEAD"))
      .pipe(Effect.orElseSucceed(() => false));
    if (fresh || !seeded) yield* seed(paths, host);
    const dotGit = path.join(paths.workspace, ".git");
    const mounts: Array<ContainerMount> = [
      { hostPath: paths.privateDir, containerPath: CONTAINER_GIT_DIR, readOnly: false },
      { hostPath: host.objects, containerPath: CONTAINER_HOST_OBJECTS, readOnly: true },
      // Cover the host's .git: a directory with an empty one, a worktree's pointer file with itself.
      {
        hostPath: host.dotGitIsDir ? paths.coverDir : dotGit,
        containerPath: containerPath(dotGit),
        readOnly: true,
      },
    ];
    return {
      mounts,
      env: { GIT_DIR: CONTAINER_GIT_DIR, GIT_WORK_TREE: containerPath(paths.workspace) },
    };
  });

  /** The commit on the container's branch, read as text: git never runs in the private dir. */
  const containerHead = Effect.fn("PrivateGit.containerHead")(function* (privateDir: string) {
    const loose = yield* fileSystem
      .readFileString(path.join(privateDir, BRANCH))
      .pipe(Effect.orElseSucceed(() => ""));
    const packed = yield* fileSystem
      .readFileString(path.join(privateDir, "packed-refs"))
      .pipe(Effect.orElseSucceed(() => ""));
    const fromPacked = packed
      .split("\n")
      .map((line) => line.trim().split(" "))
      .find(([, ref]) => ref === BRANCH)?.[0];
    const id = (loose.trim() || fromPacked || "").trim();
    return OBJECT_ID.test(id) ? id : null;
  });

  /**
   * Brings the container's commits onto the thread's branch. Objects are copied (links refused)
   * into a repository CMDeck writes, fetched from there with hardened git, and the branch moves
   * only when the host's commit is an ancestor; otherwise they stay under `ref`.
   */
  const importCommits = Effect.fn("PrivateGit.importCommits")(function* (
    paths: PrivateGitPaths,
    ref: string,
  ) {
    const head = yield* containerHead(paths.privateDir);
    if (head === null) return "none" as const;
    const host = yield* hostRepository(paths);
    if (head === host.head) return "none" as const;
    yield* reset(paths.quarantineDir);
    const source = path.join(paths.privateDir, "objects");
    const target = path.join(paths.quarantineDir, "objects");
    yield* Effect.try({
      try: () =>
        NodeFS.cpSync(source, target, {
          recursive: true,
          filter: (file) =>
            !NodeFS.lstatSync(file).isSymbolicLink() &&
            path.relative(source, file) !== path.join("info", "alternates"),
        }),
      catch: (cause) =>
        new SandboxError({ detail: "Could not copy the container's commits.", cause }),
    });
    yield* writeFile(path.join(target, "info", "alternates"), `${host.objects}\n`);
    yield* writeFile(path.join(paths.quarantineDir, "HEAD"), `${head}\n`);
    yield* writeFile(path.join(paths.quarantineDir, "refs", "heads", "import"), `${head}\n`);
    yield* writeFile(path.join(paths.quarantineDir, "config"), configFor(head, true));
    yield* git(paths, [
      "-c",
      "protocol.file.allow=always",
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      paths.quarantineDir,
      `+refs/heads/import:${ref}`,
    ]).pipe(Effect.ensuring(reset(paths.quarantineDir).pipe(Effect.ignore)));
    const ancestor = yield* git(paths, ["merge-base", "--is-ancestor", host.head, head]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!ancestor) return "kept" as const;
    // The worktree already holds the agent's files; move the branch and its index to match.
    yield* git(paths, ["reset", "-q", "--mixed", head]);
    return "imported" as const;
  });

  /** Moves a git dir whose commits could not be imported out of the way, keeping them. */
  const setAside = (paths: PrivateGitPaths, suffix: string) =>
    fileSystem
      .rename(paths.privateDir, `${paths.privateDir}-unimported-${suffix}`)
      .pipe(Effect.ignore);

  return { prepare, importCommits, setAside };
});
