// Ported from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd (Apache-2.0):
// knowledge/kiroignore.py, folder_watcher.py HARD_SKIP_DIRS, file_explorer SENSITIVE_DIRS. Changes:
// TypeScript; reads the source's `.gitignore`; adds credential defaults no ignore file can negate.

/** A rule file this large is not hand-written config; only its first part is read. */
const MAX_IGNORE_FILE_CHARS = 64 * 1024;
const MAX_RULES = 1_000;

interface Rule {
  readonly regex: RegExp;
  readonly dirOnly: boolean;
  readonly negated: boolean;
}

const escapeRegex = (char: string) => char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** One glob body (no leading or trailing `/`) as a regex fragment. */
const translate = (pattern: string): string => {
  let out = "";
  let index = 0;
  while (index < pattern.length) {
    const segmentStart = index === 0 || pattern[index - 1] === "/";
    if (pattern.startsWith("**/", index) && segmentStart) {
      out += "(?:[^/]+/)*";
      index += 3;
    } else if (pattern.startsWith("**", index) && segmentStart && index + 2 === pattern.length) {
      out += ".*";
      index += 2;
    } else if (pattern[index] === "*") {
      out += "[^/]*";
      index += 1;
    } else if (pattern[index] === "?") {
      out += "[^/]";
      index += 1;
    } else {
      out += escapeRegex(pattern[index]!);
      index += 1;
    }
  }
  return out;
};

/**
 * A gitignore subset: comments, `!` negation (last match wins), trailing `/` for folders, a `/`
 * anywhere but the end anchors at the root, `*`, `?` and segment-aligned `**`. Character classes,
 * escapes other than a leading `\#` or `\!`, and nested ignore files are not supported.
 */
const compile = (raw: string, caseInsensitive: boolean): Rule | null => {
  let line = raw.trimEnd();
  if (line === "" || line.trimStart().startsWith("#")) return null;
  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith("\\#") || line.startsWith("\\!")) {
    line = line.slice(1);
  }
  const dirOnly = line.endsWith("/");
  const body = dirOnly ? line.slice(0, -1) : line;
  const anchored = body.includes("/");
  const trimmed = body.replace(/^\/+/, "");
  if (trimmed === "") return null;
  const prefix = anchored ? "" : "(?:[^/]+/)*";
  return {
    regex: new RegExp(`^${prefix}${translate(trimmed)}$`, caseInsensitive ? "i" : ""),
    dirOnly,
    negated,
  };
};

export interface IgnoreRules {
  /** True when `relPath` (`/`-separated, relative to the source root) or a folder above it matches. */
  readonly ignores: (relPath: string, isDir: boolean) => boolean;
}

export const parseIgnore = (text: string, caseInsensitive = false): IgnoreRules => {
  const rules: Array<Rule> = [];
  for (const line of text.slice(0, MAX_IGNORE_FILE_CHARS).split(/\r?\n/)) {
    const rule = compile(line, caseInsensitive);
    if (rule !== null) rules.push(rule);
    if (rules.length >= MAX_RULES) break;
  }
  const matches = (path: string, isDir: boolean) => {
    let result = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(path)) result = !rule.negated;
    }
    return result;
  };
  return {
    ignores: (relPath, isDir) => {
      const parts = relPath.split("/").filter((part) => part !== "" && part !== ".");
      for (let depth = 1; depth <= parts.length; depth++) {
        // Every prefix shorter than the full path is a folder.
        if (matches(parts.slice(0, depth).join("/"), isDir || depth < parts.length)) return true;
      }
      return false;
    },
  };
};

/** Generated and tool folders, never indexed. */
const GENERATED_EXCLUDES = [
  ".git/",
  "node_modules/",
  "__pycache__/",
  ".venv/",
  "venv/",
  "dist/",
  "build/",
  "out/",
  "target/",
  "cdk.out/",
].join("\n");

/**
 * Credential folders and files and password-manager exports: never indexed, whatever a `.gitignore`
 * says, and never accepted as a source. Matched without regard to case.
 */
const SECRET_EXCLUDES = [
  ".ssh/",
  ".aws/",
  ".gnupg/",
  ".docker/",
  ".kube/",
  ".azure/",
  "gcloud/",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".env*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.ppk",
  "*.jks",
  "*.keystore",
  "id_*",
  "*credentials*",
  "*secret*",
  // Password-manager databases and exports.
  "*.kdbx",
  "*.kdb",
  "*.1pux",
  "*.1pif",
  "*bitwarden*",
  "*lastpass*",
  "*keepass*",
  "*1password*",
  "*passwords*.csv",
  "*password*export*",
].join("\n");

const generated = parseIgnore(GENERATED_EXCLUDES, true);
const secrets = parseIgnore(SECRET_EXCLUDES, true);

/** True when the path, or a folder in it, is a credential or password-manager path. */
export const isSecretPath = (relPath: string, isDir: boolean): boolean =>
  secrets.ignores(relPath, isDir);

/** True when a default rule excludes the path; no ignore file can bring it back. */
export const isDefaultExcluded = (relPath: string, isDir: boolean): boolean =>
  isSecretPath(relPath, isDir) || generated.ignores(relPath, isDir);
