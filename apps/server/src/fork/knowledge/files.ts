// @effect-diagnostics nodeBuiltinImport:off -- lstat, typed readdir and no-follow opens need node:fs.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { KnowledgeSourceKind } from "@t3tools/contracts";

import { isDefaultExcluded, isSecretPath, type IgnoreRules, parseIgnore } from "./ignore.ts";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_SOURCE_FILES = 5_000;
/** A NUL in the first bytes marks a binary file. */
const BINARY_SNIFF_BYTES = 8_000;

/** The host the server runs on, from HostProcess. */
export interface HostEnv {
  readonly platform: NodeJS.Platform;
  readonly home: string;
}

const caseInsensitive = (env: HostEnv) => env.platform === "win32" || env.platform === "darwin";

/** True when `child` is `parent` or inside it. */
const isWithin = (env: HostEnv, parent: string, child: string): boolean => {
  const fold = (path: string) => (caseInsensitive(env) ? path.toLowerCase() : path);
  const relative = NodePath.relative(fold(parent), fold(child));
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

const systemFolders = (env: HostEnv) =>
  env.platform === "win32"
    ? ["Windows", "Program Files", "Program Files (x86)", "ProgramData"].map((name) =>
        NodePath.join(NodePath.parse(env.home).root, name),
      )
    : // Not /var or /private: macOS keeps per-user temporary folders below them.
      ["/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr", "/System"];

/** Why a resolved path may not be a source, or null when it may. */
export const refusalFor = (env: HostEnv, real: string): string | null => {
  if (NodePath.parse(real).root === real) {
    return "A whole drive or the file system root cannot be a source.";
  }
  // The home folder, or a folder holding it, would take in every credential folder below it.
  if (isWithin(env, real, env.home)) {
    return "Your home folder, or a folder that holds it, cannot be a source.";
  }
  if (systemFolders(env).some((folder) => isWithin(env, folder, real))) {
    return "A system folder cannot be a source.";
  }
  const segments = real.slice(NodePath.parse(real).root.length).split(NodePath.sep).join("/");
  if (isSecretPath(segments, false) || isSecretPath(segments, true)) {
    return "Credential and password folders and files are never indexed.";
  }
  return null;
};

export type ResolvedSource =
  | { readonly _tag: "Ok"; readonly path: string }
  | { readonly _tag: "Refused"; readonly message: string };

/**
 * The real path a source names, after symlinks, checked against the refusals. A notes folder must
 * sit inside the project and is created when missing.
 */
export const resolveSourcePath = async (input: {
  readonly env: HostEnv;
  readonly projectRoot: string;
  readonly kind: KnowledgeSourceKind;
  readonly path: string;
}): Promise<ResolvedSource> => {
  const requested = NodePath.resolve(input.projectRoot, input.path);
  if (input.kind === "notes") {
    if (!isWithin(input.env, input.projectRoot, requested)) {
      return { _tag: "Refused", message: "The notes folder must be inside the project." };
    }
    await NodeFS.promises.mkdir(requested, { recursive: true });
  }
  const real = await NodeFS.promises.realpath(requested).catch(() => null);
  if (real === null) return { _tag: "Refused", message: "Nothing exists at that path." };
  if (input.kind === "notes") {
    const projectReal = await NodeFS.promises.realpath(input.projectRoot).catch(() => null);
    if (projectReal === null || !isWithin(input.env, projectReal, real)) {
      return { _tag: "Refused", message: "The notes folder must be inside the project." };
    }
  }
  const stat = await NodeFS.promises.stat(real);
  if (input.kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    return {
      _tag: "Refused",
      message: input.kind === "file" ? "That path is not a file." : "That path is not a folder.",
    };
  }
  const refusal = refusalFor(input.env, real);
  return refusal === null ? { _tag: "Ok", path: real } : { _tag: "Refused", message: refusal };
};

/** The absolute path of a file a source holds. */
export const sourceFilePath = (sourcePath: string, kind: KnowledgeSourceKind, relPath: string) =>
  kind === "file" ? sourcePath : NodePath.join(sourcePath, ...relPath.split("/"));

export interface FoundFile {
  readonly relPath: string;
  readonly absPath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface Walk {
  readonly files: ReadonlyArray<FoundFile>;
  /** Files over a size cap. Excluded and binary files are not counted here. */
  readonly skipped: number;
}

/** A regular file's text, or null when it is not one, is binary, or outgrew the cap. */
export const readText = async (
  absPath: string,
): Promise<{ readonly text: string; readonly hash: string } | null> => {
  // O_NOFOLLOW refuses a file swapped for a symlink after the walk; Windows has no such flag.
  const flags = NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0);
  const handle = await NodeFS.promises.open(absPath, flags).catch(() => null);
  if (handle === null) return null;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_FILE_BYTES) return null;
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return null;
    return {
      text: bytes.toString("utf8"),
      hash: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await handle.close();
  }
};

const loadGitignore = async (env: HostEnv, root: string): Promise<IgnoreRules | null> => {
  const path = NodePath.join(root, ".gitignore");
  const stat = await NodeFS.promises.lstat(path).catch(() => null);
  if (stat === null || !stat.isFile()) return null;
  const read = await readText(path);
  return read === null ? null : parseIgnore(read.text, caseInsensitive(env));
};

/**
 * The files of a source, never following a symlink or junction: default excludes first (no
 * `.gitignore` rule can bring those back), then the root `.gitignore`, then the size caps.
 * `shouldStop` is checked between folders so a cancelled walk ends early.
 */
export const walkSource = async (
  env: HostEnv,
  root: string,
  kind: KnowledgeSourceKind,
  shouldStop: () => boolean = () => false,
): Promise<Walk> => {
  if (kind === "file") {
    const stat = await NodeFS.promises.lstat(root);
    if (!stat.isFile()) return { files: [], skipped: 0 };
    const tooLarge = stat.size > MAX_FILE_BYTES;
    return {
      files: tooLarge
        ? []
        : [
            {
              relPath: NodePath.basename(root),
              absPath: root,
              size: stat.size,
              mtimeMs: Math.trunc(stat.mtimeMs),
            },
          ],
      skipped: tooLarge ? 1 : 0,
    };
  }
  const gitignore = await loadGitignore(env, root);
  const files: Array<FoundFile> = [];
  let skipped = 0;
  let total = 0;
  const pending = [""];
  while (pending.length > 0 && !shouldStop()) {
    const relDir = pending.shift()!;
    const entries = await NodeFS.promises
      .readdir(NodePath.join(root, relDir), { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const isDir = entry.isDirectory();
      if (!isDir && !entry.isFile()) continue;
      if (isDefaultExcluded(relPath, isDir) || gitignore?.ignores(relPath, isDir) === true)
        continue;
      if (isDir) {
        pending.push(relPath);
        continue;
      }
      const absPath = NodePath.join(root, relPath);
      const stat = await NodeFS.promises.lstat(absPath).catch(() => null);
      if (stat === null || !stat.isFile()) continue;
      if (
        stat.size > MAX_FILE_BYTES ||
        total + stat.size > MAX_SOURCE_BYTES ||
        files.length >= MAX_SOURCE_FILES
      ) {
        skipped++;
        continue;
      }
      total += stat.size;
      files.push({ relPath, absPath, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) });
    }
  }
  return { files, skipped };
};
