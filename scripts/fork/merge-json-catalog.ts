#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - A git merge driver; synchronous Node APIs keep it small.
// Merges flat `key -> value` JSON catalogs (the GT translation files) entry by entry, so two
// branches that each add strings merge cleanly. A key both sides changed differently, or a file
// not in the formatted one-entry-per-key layout, falls back to git's own text merge and conflicts.
// Registered for the catalogs in `.gitattributes`; `--install` writes the local git config.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const DRIVER = "cmdeck-json-catalog";

/** Each top-level entry's formatted text by key, or undefined when the layout is not recognized. */
const entries = (text: string): Map<string, string> | undefined => {
  if (text === "" || text === "{}\n") return new Map();
  if (!text.startsWith("{\n") || !text.endsWith("\n}\n")) return undefined;
  const body = text.slice(2, -3);
  // Nested lines are indented further, so only top-level keys start a line with `  "`.
  const starts = [...body.matchAll(/^ {2}"/gm)].map((match) => match.index);
  if (starts[0] !== 0) return undefined;
  const chunks = starts.map((start, index) =>
    body.slice(start, starts[index + 1] ?? body.length).replace(/,\n$/, ""),
  );
  if (`{\n${chunks.join(",\n")}\n}\n` !== text) return undefined;
  const map = new Map<string, string>();
  for (const chunk of chunks) {
    let keys: Array<string>;
    try {
      keys = Object.keys(JSON.parse(`{${chunk}}`));
    } catch {
      return undefined;
    }
    const [key] = keys;
    if (keys.length !== 1 || key === undefined || map.has(key)) return undefined;
    map.set(key, chunk);
  }
  return map;
};

/** The merged catalog text, or undefined when it needs a person. */
export function mergeCatalog(base: string, ours: string, theirs: string): string | undefined {
  const [b, o, t] = [entries(base), entries(ours), entries(theirs)];
  if (b === undefined || o === undefined || t === undefined) return undefined;
  const merged = new Map(o);
  for (const key of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
    const [was, mine, other] = [b.get(key), o.get(key), t.get(key)];
    if (mine === other || other === was) continue;
    if (mine !== was) return undefined;
    if (other === undefined) merged.delete(key);
    else merged.set(key, other);
  }
  return merged.size === 0 ? "{}\n" : `{\n${[...merged.values()].join(",\n")}\n}\n`;
}

const git = (args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });

const [command, ...rest] = import.meta.main ? process.argv.slice(2) : [];
if (command === "--install") {
  // Skipped outside a git checkout (a tarball install), where there is nothing to merge.
  if (git(["rev-parse", "--git-dir"]).status === 0) {
    git(["config", `merge.${DRIVER}.name`, "CMDeck JSON catalog merge"]);
    git(["config", `merge.${DRIVER}.driver`, "node scripts/fork/merge-json-catalog.ts %O %A %B"]);
  }
} else if (command !== undefined && rest.length === 2) {
  const [base, ours, theirs] = [command, ...rest] as [string, string, string];
  const read = (file: string) => NodeFS.readFileSync(file, "utf8");
  const merged = mergeCatalog(read(base), read(ours), read(theirs));
  if (merged !== undefined) {
    NodeFS.writeFileSync(ours, merged);
  } else {
    const result = git([
      "merge-file",
      "-L",
      "ours",
      "-L",
      "base",
      "-L",
      "theirs",
      ours,
      base,
      theirs,
    ]);
    process.exitCode = result.status === 0 ? 0 : 1;
  }
}
