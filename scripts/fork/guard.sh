#!/usr/bin/env bash
# Fork invariants that an upstream merge can silently undo. Run after every upstream merge (and in CI).
# Usage: scripts/fork/guard.sh [upstream-ref]   (default: upstream/main when that ref exists)
set -uo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
REF="${1:-upstream/main}"
fail=0
bad() { echo "FAIL: $*" >&2; fail=1; }

# 1. The official T3 mobile app pairs only while the protocol version matches upstream.
if git rev-parse --verify -q "$REF" >/dev/null; then
  ours="$(grep -E '^export const ORCHESTRATION_PROTOCOL_VERSION' packages/contracts/src/environment.ts)"
  theirs="$(git show "$REF:packages/contracts/src/environment.ts" | grep -E '^export const ORCHESTRATION_PROTOCOL_VERSION')"
  [ "$ours" = "$theirs" ] || bad "protocol version differs from $REF: '$ours' vs '$theirs'"

  # 2. Fork tables live in ForkSchema.ts. A numbered fork migration would make the migrator skip upstream ones.
  extra="$(comm -23 \
    <(git ls-files apps/server/src/persistence/Migrations | sort) \
    <(git ls-tree -r --name-only "$REF" apps/server/src/persistence/Migrations | sort))"
  [ -z "$extra" ] || bad "fork-only numbered migrations (move them into ForkSchema.ts): $extra"
else
  echo "note: $REF not found; skipping upstream comparisons (git fetch upstream first)." >&2
fi

# 3. Code that must not come back. Docs, tests, this guard and the (unused) hosted-relay API contract are excluded.
forbidden=(
  'ingest\.t3\.codes'
  'posthog'
  'expo-observe'
  'v1internal'
  'antigravityUsageLimits'
  'relay\.t3\.codes'
  '@opentelemetry/exporter'
  'OTLPTraceExporter'
  # A1: local tracing only; no OTLP exporter may be wired back in.
  'effect/(unstable/)?observability'
  'Otlp(Exporter|Serialization|Logger)'
  'Otlp(Tracer|Metrics)\.'
  'github\.com/\$\{CLI_RELEASE_REPOSITORY\}/releases/download'
  'AnalyticsService'
  'telemetryId'
  'axiom'
  'u\.expo\.dev'
  'registry\.npmjs\.org/t3'
  'name: "zed"'
  'pingdotgg/t3code/releases'
  'CLI_RELEASE_REPOSITORY = "pingdotgg'
  # Agents must not be told to follow text from upstream's repository during triage.
  'raw\.githubusercontent\.com/pingdotgg'
  't3\.codes/install'
  # Link icons come from the site itself (opt-in), never a third-party icon service.
  'google\.com/s2/favicons'
)
for pattern in "${forbidden[@]}"; do
  hits="$(git grep -n -i -E "$pattern" -- apps packages scripts ':!scripts/fork/**' ':!**/*.md' ':!apps/marketing/**' ':!**/*.graphql' ':!**/*.test.ts' ':!**/*.test.tsx' ':!**/testkit/fixtures/**' ':!packages/contracts/src/relay.ts' | head -5)"
  [ -z "$hits" ] || bad "forbidden pattern '$pattern' is back:"$'\n'"$hits"
done

# Code that must not come back in one file.
forbidden_in=(
  # The Antigravity CLI keeps per-profile sign-ins only when it believes it runs over SSH.
  'apps/server/src/provider/antigravityAuthSupport.ts:SSH_CONNECTION'
)
for entry in "${forbidden_in[@]}"; do
  file="${entry%%:*}"
  ! grep -q -E "${entry#*:}" "$file" || bad "$file has '${entry#*:}' again"
done

# 4. The only release feed an installer may carry is CMDeck's own GitHub releases
#    (Tehcnological/cmdeck); any other feed would let the app replace itself with an upstream build.
if git grep -q -E 'resolveGitHubPublishConfig\(updateChannel\)|GITHUB_REPOSITORY|pingdotgg|repo: "t3code"' -- scripts/build-desktop-artifact.ts; then
  bad "scripts/build-desktop-artifact.ts may publish an update feed other than Tehcnological/cmdeck"
fi
{ grep -q -E '^export const APP_RELEASE_OWNER = "Tehcnological";$' packages/shared/src/appIdentity.ts &&
  grep -q -E '^export const APP_RELEASE_REPO = "cmdeck";$' packages/shared/src/appIdentity.ts; } ||
  bad "packages/shared/src/appIdentity.ts no longer names Tehcnological/cmdeck as the release feed"

# 4b. Without T3CODE_RELEASE_BASE_URL, installs, SSH bootstraps and `cmdeck update` download CLI
#     archives from CMDeck's own GitHub releases (the repository pinned in 4), never another host.
{ grep -q -F 'export const APP_RELEASE_DOWNLOAD_BASE_URL = `https://github.com/${APP_RELEASE_REPOSITORY}/releases/download`;' packages/shared/src/appIdentity.ts &&
  grep -q -x -F 'const CLI_RELEASE_DEFAULT_BASE_URL = APP_RELEASE_DOWNLOAD_BASE_URL;' packages/shared/src/cliRelease.ts; } ||
  bad "the default CLI release base URL is no longer CMDeck's GitHub releases (packages/shared/src/cliRelease.ts)"

# 5. Fork hooks and the CMDeck identity live in upstream files; a merge that takes upstream's side drops them.
#    One file per fork module in scripts/fork/hooks/, each line `path:regex` (line breaks match as spaces).
required=()
for hooks in scripts/fork/hooks/*.txt; do
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in '' | '#'*) ;; *) required+=("$line") ;; esac
  done <"$hooks"
done
[ "${#required[@]}" -gt 0 ] || bad "no fork hooks found in scripts/fork/hooks/"

# 6. Only a person approves a workflow file: no MCP tool may reach the trust gate (WI-1.06).
hits="$(git grep -l -E 'WorkflowTrust|workflowTrust' -- apps/server/src/mcp apps/server/src/fork/mcpToolkits.ts apps/server/src/fork/mcpToolModules.ts)"
[ -z "$hits" ] || bad "MCP code reaches the workflow trust gate: $hits"

# 7. Only a person approves a check script: no MCP code may reach its approval (WI-2.11).
hits="$(git grep -l -E '\.approve\(|checkScriptsApprove' -- apps/server/src/mcp apps/server/src/fork/mcpToolkits.ts apps/server/src/fork/mcpToolModules.ts apps/server/src/fork/checkScripts/mcpTools.ts)"
[ -z "$hits" ] || bad "MCP code reaches check script approval: $hits"

# 8. WI-2.17: a file that builds the secret store must build the encrypting one, or it reads and
#    writes envelopes as raw bytes. Its `ServerSecretStore` import names the fork module instead.
for file in $(git grep -l -E 'ServerSecretStore\.layer([^A-Za-z]|$)' -- apps/server/src ':!apps/server/src/fork/**' ':!**/*.test.ts' ':!**/*.testkit.ts' ':!**/testkit/**'); do
  grep -q -E '^import \* as ServerSecretStore from "(\./|(\.\./)+)fork/secrets/EncryptedSecretStore\.ts";' "$file" ||
    bad "$file builds ServerSecretStore.layer without fork/secrets/EncryptedSecretStore.ts"
done

# 8. Agents may only tighten the sandbox: no MCP tool turns a container off (WI-2.18).
hits="$(git grep -l -E '"off"|mode: null' -- apps/server/src/fork/sandbox/mcpTools.ts)"
[ -z "$hits" ] || bad "An MCP tool can turn a container off: $hits"

for entry in "${required[@]}"; do
  file="${entry%%:*}"
  { tr '\r\n' '  ' <"$file" | grep -q -E "${entry#*:}"; } 2>/dev/null ||
    bad "$file lost its fork hook '${entry#*:}'"
done

if [ "$fail" -ne 0 ]; then
  echo "Fork guard failed. See docs/operations/fork-upstream-sync.md." >&2
  exit 1
fi
echo "Fork guard passed."
