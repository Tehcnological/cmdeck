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
required=(
  'apps/server/src/cloud/pinnedRuntime.ts:FORK_RUNTIME_MARKER_FILE'
  'apps/server/src/serviceLauncher.ts:FORK_RUNTIME_MARKER_FILE'
  'scripts/install.sh:\.cmdeck"'
  'scripts/install.ps1:"\.cmdeck"'
  'packages/ssh/src/tunnel.ts:T3_STAGING/\.cmdeck'
  'apps/server/src/server.ts:ForkAlerts\.layer'
  'apps/server/src/ws.ts:ForkAlerts\.configIssues'
  'packages/contracts/src/server.ts:fork\.shared-data'
  'apps/web/src/appInit.tsx:startForkSharedDataToasts'
  'apps/server/src/binCli.ts:importFromT3Command'
  'apps/server/src/ws.ts:T3Import\.importOfferIssues'
  'packages/contracts/src/server.ts:fork\.import-available'
  'apps/web/src/appInit.tsx:startForkImportOfferToast'
  'packages/shared/src/appIdentity.ts:APP_DISPLAY_NAME = "CMDeck"'
  'apps/server/src/os-jank.ts:APP_HOME_DIR_NAME'
  'apps/desktop/src/app/DesktopStatePaths.ts:APP_HOME_DIR_NAME'
  'apps/desktop/src/app/DesktopUserData.ts:DESKTOP_USER_DATA_DIR_NAME'
  'apps/server/src/cloud/bootService.ts:SERVICE_LAUNCHD_LABEL'
  'scripts/build-desktop-artifact.ts:com\.tehcnological\.cmdeck'
  'scripts/build-desktop-artifact.ts:owner: APP_RELEASE_OWNER, +repo: APP_RELEASE_REPO,'
  'apps/server/src/bin.ts:applyAppHomeEnv'
  # Fork tables are created from upstream's migrator; taking upstream's file drops them silently.
  'apps/server/src/persistence/Migrations.ts:import \{ ensureForkSchema \} from "\./ForkSchema\.ts"'
  'apps/server/src/persistence/Migrations.ts:yield\* ensureForkSchema\(\)'
  # What the fork turned off. Line breaks are matched as spaces.
  'apps/server/src/policy/managedLimits.ts:export const allowsConnect = \(_policy: PolicyDocument\): boolean => false;'
  'apps/web/src/cloud/publicConfig.ts:return \{ clerkPublishableKey: null, clerkJwtTemplate: null, relayUrl: null \};'
  'apps/server/src/cloud/npmRelease.ts:Effect\.fn\("NpmRelease\.get"\)\(function\* \(\) \{ +return null;'
  'packages/contracts/src/settings.ts:requireConnectDeviceApproval: Schema\.Boolean\.pipe\( +Schema\.withDecodingDefault\(Effect\.succeed\(true\)\)'
  'apps/mobile/app.config.ts:updates: \{ +enabled: false,'
  'apps/server/src/provider/acp/AntigravityAcpSupport.ts:clientInfo: \{ name: "t3-code",'
  # Fork extension seams (docs/operations/fork-upstream-sync.md#where-fork-code-goes).
  'apps/server/src/server.ts:Layer\.provideMerge\(ForkLayer\.layer\)'
  'apps/server/src/ws.ts:\.\.\.\(yield\* ForkRpcHandlers\.make\)'
  'apps/server/src/mcp/McpHttpServer.ts:ForkMcpToolkits\.layer\(toolkitRegistration\)'
  'packages/contracts/src/rpc.ts:\.merge\(ForkWsRpcGroup\)'
  'packages/contracts/src/clientRpcPermissions.ts:\.\.\.FORK_RPC_SCOPES,'
  'packages/contracts/src/index.ts:export \* from "\./fork/index\.ts";'
  'packages/contracts/src/settings.ts:cmdeck: CmdeckSettings\.pipe\(Schema\.withDecodingDefault'
  'packages/contracts/src/settings.ts:cmdeck: Schema\.optionalKey\(CmdeckSettingsPatch\)'
  'apps/web/src/components/CommandPalette.tsx:const forkCommandItems = useForkCommandItems\(\);'
  'apps/web/src/components/CommandPalette.tsx:actionItems\.push\(\.\.\.forkCommandItems\);'
  # The star prompt stars CMDeck's repository, not upstream's.
  'apps/web/src/components/GitHubStarPrompt.tsx:const REPOSITORY = APP_RELEASE_REPOSITORY;'
  # WI-1.02: the shared redactor applies at log, feedback and webhook-prompt egress.
  'packages/shared/package.json:"\./redaction"'
  'apps/server/src/serverLogger.ts:redactingSecrets\(redactingCredentials\(Logger\.consolePretty\(\)\)\)'
  'apps/server/src/feedback/scrubFeedback.ts:\.\.\.SECRET_PATTERNS,'
  'apps/server/src/scheduledTasks/webhookTemplate.ts:expression === "request" \? redactSecrets\(text\) : text'
)
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
