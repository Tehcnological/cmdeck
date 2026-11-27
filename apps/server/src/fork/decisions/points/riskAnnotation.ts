// Ported from KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd src/kiro_crew/decisions/points/tool_risk.py (Apache-2.0):
// tier names, rubric and confidence bars. Changes: a deterministic rule table sets the tier first,
// and a model may only raise it.
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Decisions } from "../Decisions.ts";
import type { DecisionPointSpec } from "../spec.ts";

export type RiskTier = "safe" | "caution" | "risky";

const TIERS: ReadonlyArray<RiskTier> = ["safe", "caution", "risky"];

/** Confidence a model answer needs before it raises a tier. */
const RISKY_CONFIDENCE = 0.8;
const CAUTION_CONFIDENCE = 0.8;

const PROMPT =
  "How risky is this tool call for the person whose machine it runs on? Answer safe when it only reads or reports. Answer caution when it changes something inside the workspace that is easy to put back. Answer risky when it destroys data, touches credentials, sends local data out over the network, or acts outside the workspace.";

export interface RiskInput {
  readonly projectId: ProjectId | null;
  readonly toolName?: string | undefined;
  readonly command?: string | undefined;
  readonly paths?: ReadonlyArray<string> | undefined;
  readonly workspaceRoot?: string | undefined;
  /** A plain file write or edit; it never draws `caution` from a model, since the card already says so. */
  readonly fileWrite?: boolean | undefined;
}

export interface RiskAnnotation {
  readonly tier: RiskTier;
  readonly reasons: ReadonlyArray<string>;
}

interface RiskRule {
  readonly tier: Exclude<RiskTier, "safe">;
  readonly reason: string;
  readonly pattern: RegExp;
}

const COMMAND_RULES: ReadonlyArray<RiskRule> = [
  { tier: "risky", reason: "recursive delete", pattern: /\brm\s+(-\w*\s+)*-\w*[rR]/u },
  {
    tier: "risky",
    reason: "recursive delete",
    pattern: /\bremove-item\b.*-recurse|\b(rd|rmdir|del)\s+\/s\b/iu,
  },
  {
    tier: "risky",
    reason: "rewrites history",
    pattern: /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)|\bgit\s+reset\s+--hard\b/u,
  },
  { tier: "risky", reason: "discards files", pattern: /\bgit\s+(clean\s+-\w*f|branch\s+-D\b)/u },
  {
    tier: "risky",
    reason: "wipes a disk",
    pattern: /\b(mkfs(\.\w+)?|shred|format\s+[a-z]:)\b|\bdd\s+.*\bof=/iu,
  },
  {
    tier: "risky",
    reason: "drops data",
    pattern: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/iu,
  },
  {
    tier: "risky",
    reason: "runs downloaded code",
    pattern: /\b(curl|wget|iwr|irm)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\|\s*iex\b/iu,
  },
  { tier: "risky", reason: "runs as administrator", pattern: /(^|[;&|]\s*)sudo\s/u },
  { tier: "risky", reason: "opens permissions", pattern: /\bchmod\s+(-\w+\s+)*0?777\b/u },
  {
    tier: "risky",
    reason: "sends data off the machine",
    pattern:
      /\bgit\s+push\b|\b(scp|sftp|rsync)\b.*\S+:|\bcurl\b.*\s(-d|--data\S*|-F|--form|-T|--upload-file)\s|\b(npm|pnpm|yarn|cargo)\s+publish\b|\bgh\s+(pr\s+create|release\s+create|gist\s+create)\b/u,
  },
  {
    tier: "caution",
    reason: "changes the workspace",
    pattern:
      /\bgit\s+(commit|merge|rebase|checkout|switch|stash|cherry-pick|am|apply)\b|\b(npm|pnpm|yarn|bun|pip|uv|cargo)\s+(i|install|add|remove|uninstall|update|upgrade)\b|\b(mv|cp|mkdir|touch|ln)\s|\bsed\s+-i\b|\brm\s/u,
  },
];

const CREDENTIAL_PATH =
  /(^|[/\\])(\.ssh[/\\]|\.aws[/\\]|\.gnupg[/\\]|\.kube[/\\]config|\.docker[/\\]config\.json|\.netrc$|\.npmrc$|\.pypirc$|\.pgpass$|\.git-credentials$|\.env(\.[\w-]+)?$|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$|credentials(\.json)?$|[\w-]+\.(pem|key|p12|pfx|kdbx)$)|(^|[/\\])etc[/\\]shadow$|[/\\]Keychains[/\\]/iu;

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-z]:[/\\]/iu.test(path);

const outsideWorkspace = (path: string, root: string) => {
  if (!isAbsolute(path)) return false;
  const target = normalize(path);
  const base = normalize(root);
  return target !== base && !target.startsWith(`${base}/`);
};

/** The deterministic tier: destructive shapes, credentials, network sends and writes outside the workspace. */
export const ruleRisk = (input: RiskInput): RiskAnnotation => {
  const found: Array<{ readonly tier: RiskTier; readonly reason: string }> = [];
  const raise = (tier: RiskTier, reason: string) => found.push({ tier, reason });
  if (input.fileWrite === true) raise("caution", "writes a file");
  const command = input.command ?? "";
  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(command)) raise(rule.tier, rule.reason);
  }
  const words = command.split(/[\s"'=]+/u).filter((word) => word.length > 0);
  for (const path of [...(input.paths ?? []), ...words]) {
    if (CREDENTIAL_PATH.test(path)) raise("risky", "touches credentials");
  }
  if (input.workspaceRoot !== undefined && input.fileWrite === true) {
    for (const path of input.paths ?? []) {
      if (outsideWorkspace(path, input.workspaceRoot))
        raise("risky", "writes outside the workspace");
    }
  }
  const tier = TIERS[Math.max(0, ...found.map((entry) => TIERS.indexOf(entry.tier)))] ?? "safe";
  // Only the reasons for the tier shown; a caution reason beside a risky one is noise.
  const reasons = new Set(
    found.filter((entry) => entry.tier === tier).map((entry) => entry.reason),
  );
  return { tier, reasons: [...reasons] };
};

export const riskAnnotation: DecisionPointSpec<RiskInput, RiskAnnotation> = {
  point: "riskAnnotation",
  rule: ruleRisk,
  ask: (input, ruled) =>
    ruled.tier === "risky"
      ? undefined
      : {
          state: [
            `Tool: ${(input.toolName ?? "unknown").slice(0, 120)}`,
            input.command === undefined ? "" : `Command: ${input.command.slice(0, 2_000)}`,
            input.paths === undefined || input.paths.length === 0
              ? ""
              : `Paths: ${input.paths.slice(0, 20).join(", ")}`,
          ]
            .filter((line) => line.length > 0)
            .join("\n"),
          questions: [{ kind: "choice", id: "risk", prompt: PROMPT, options: TIERS }],
        },
  combine: (input, ruled, answers) => {
    const answer = answers.get("risk");
    const tier = TIERS.find((candidate) => candidate === answer?.value);
    if (answer === undefined || tier === undefined) return ruled;
    const earns =
      tier === "risky"
        ? answer.confidence >= RISKY_CONFIDENCE
        : tier === "caution" && input.fileWrite !== true && answer.confidence >= CAUTION_CONFIDENCE;
    return earns && TIERS.indexOf(tier) > TIERS.indexOf(ruled.tier)
      ? { tier, reasons: [...ruled.reasons, "model"] }
      : ruled;
  },
  timeout: "5 seconds",
};

/**
 * WI-2.16's call site, after the approval policy has decided. The policy verdict passes through
 * untouched: an annotation is shown on the approval card and never consulted.
 */
export const annotateApproval = <P>(input: {
  readonly request: RiskInput;
  readonly policy: P;
}): Effect.Effect<{ readonly policy: P; readonly annotation: RiskAnnotation }> =>
  Effect.serviceOption(Decisions).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(ruleRisk(input.request)),
        onSome: (decisions) =>
          decisions
            .decide(riskAnnotation, input.request, { projectId: input.request.projectId })
            .pipe(Effect.map((decided) => decided.value)),
      }),
    ),
    Effect.map((annotation) => ({ policy: input.policy, annotation })),
  );
