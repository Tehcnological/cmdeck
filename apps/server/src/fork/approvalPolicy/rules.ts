// @effect-diagnostics nodeBuiltinImport:off - pure rule checks resolve paths for a platform given as data.
import * as NodePath from "node:path";

import type { ApprovalPolicyRules } from "@t3tools/contracts";

/** What an approval request asks for, gathered from its card and the tool call it belongs to. */
export interface ApprovalFacts {
  readonly toolName?: string | undefined;
  /** The command the shell would run. */
  readonly command?: string | undefined;
  /** Every text that can name a path: the command, the card's prompt, file names, tool input. */
  readonly texts: ReadonlyArray<string>;
  /** Files a file change would write. */
  readonly writePaths: ReadonlyArray<string>;
  /** The provider session's working directory. */
  readonly workspaceRoot?: string | undefined;
}

export interface PolicyEnvironment {
  readonly home: string;
  readonly platform: NodeJS.Platform;
}

export type PolicyVerdict =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly rule: string; readonly reason: string };

const ALLOW: PolicyVerdict = { decision: "allow" };

export const hasRules = (rules: ApprovalPolicyRules) =>
  rules.denyCommands.length > 0 ||
  rules.denyTools.length > 0 ||
  rules.protectedPaths.length > 0 ||
  rules.denyWritesOutsideWorkspace;

const escapeRegExp = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * One spelling for paths in free text: forward slashes, lower case, and the home directory written
 * out, whichever shell wrote it (`~`, `$HOME`, `%USERPROFILE%`, `$env:USERPROFILE`, Git Bash `/c/`).
 * Lower case on every platform: a deny gate may over-match a case variant, never miss one.
 */
const normalizeText = (text: string, env: PolicyEnvironment) => {
  const home = env.home.replaceAll("\\", "/").replace(/\/+$/u, "");
  const slashed = text
    .replaceAll("\\", "/")
    .replaceAll(
      /\$\{?home\}?(?!\w)|%userprofile%|\$env:userprofile|\$\{?userprofile\}?(?!\w)/giu,
      home,
    )
    .replaceAll(/(^|[\s"'=(:,])~(?=\/|$|[\s"'),;|&])/gu, `$1${home}`);
  const drives =
    env.platform === "win32"
      ? slashed.replaceAll(/(^|[\s"'=(,])\/([a-z])\//giu, "$1$2:/")
      : slashed;
  // Shells split one path across quotes (`"C:/Users"/x`); a path never contains one.
  return drives
    .replaceAll(/["']/gu, "")
    .replaceAll(/\/{2,}/gu, "/")
    .toLowerCase();
};

const PATH_CHAR = String.raw`[\w.\-~]`;

/** Matches the entry as whole path segments: `.aws` does not match `.aws-backup`. */
const protectedPathPattern = (entry: string, env: PolicyEnvironment) => {
  const normalized = normalizeText(entry, env).replace(/\/+$/u, "");
  return new RegExp(`(?<!${PATH_CHAR})${escapeRegExp(normalized)}(?!${PATH_CHAR})`, "u");
};

const compile = (source: string) => {
  try {
    return new RegExp(source, "iu");
  } catch {
    return undefined;
  }
};

const toolMatches = (pattern: string, toolName: string) => {
  const wanted = pattern.toLowerCase();
  const name = toolName.toLowerCase();
  return wanted.endsWith("*") ? name.startsWith(wanted.slice(0, -1)) : name === wanted;
};

const outsideWorkspace = (path: string, root: string, platform: NodeJS.Platform) => {
  const paths = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const relative = paths.relative(root, paths.resolve(root, path));
  return relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative);
};

/** The first rule the request breaks, in a fixed order: tools, commands, paths, then writes. */
export const evaluate = (
  rules: ApprovalPolicyRules,
  facts: ApprovalFacts,
  env: PolicyEnvironment,
): PolicyVerdict => {
  if (facts.toolName !== undefined) {
    const toolName = facts.toolName;
    const tool = rules.denyTools.find((pattern) => toolMatches(pattern, toolName));
    if (tool !== undefined) {
      return {
        decision: "deny",
        rule: `denyTools: ${tool}`,
        reason: `the tool ${toolName} is denied`,
      };
    }
  }
  if (facts.command !== undefined) {
    const command = facts.command;
    for (const source of rules.denyCommands) {
      const pattern = compile(source);
      // A deny rule that cannot be read declines rather than lets everything through.
      if (pattern === undefined || pattern.test(command)) {
        return {
          decision: "deny",
          rule: `denyCommands: ${source}`,
          reason:
            pattern === undefined
              ? `the deny pattern ${source} is not a valid regular expression; fix it in the approval policy`
              : "the command matches a denied pattern",
        };
      }
    }
  }
  if (rules.protectedPaths.length > 0) {
    const text = facts.texts.map((entry) => normalizeText(entry, env)).join("\n");
    const entry = rules.protectedPaths.find((path) => protectedPathPattern(path, env).test(text));
    if (entry !== undefined) {
      return {
        decision: "deny",
        rule: `protectedPaths: ${entry}`,
        reason: `it touches the protected path ${entry}`,
      };
    }
  }
  if (rules.denyWritesOutsideWorkspace && facts.workspaceRoot !== undefined) {
    const root = facts.workspaceRoot;
    const outside = facts.writePaths.find((path) => outsideWorkspace(path, root, env.platform));
    if (outside !== undefined) {
      return {
        decision: "deny",
        rule: "denyWritesOutsideWorkspace",
        reason: `it writes ${outside}, outside the workspace`,
      };
    }
  }
  return ALLOW;
};
