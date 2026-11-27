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
  'apps/server/src/binCli.ts:importCommand,'
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
  # WI-1.12: any thread opens beside the current one from the sidebar menu.
  'apps/web/src/components/threadActionMenu.logic.ts:id: "open-beside" as const'
  'apps/web/src/components/Sidebar.tsx:canOpenBeside: canOpenThreadBeside\(threadRef, routeThreadRef\)'
  'apps/web/src/components/Sidebar.tsx:case "open-beside": +if \(openThreadBeside\('
  'apps/web/src/lib/sideChatPane.ts:export function canOpenThreadInPanel\('
  # The star prompt stars CMDeck's repository, not upstream's.
  'apps/web/src/components/GitHubStarPrompt.tsx:const REPOSITORY = APP_RELEASE_REPOSITORY;'
  # WI-1.11: the Amazon Bedrock preset in the Claude provider dialog.
  'apps/web/src/components/settings/AddProviderInstanceDialog.tsx:<BedrockPresetSection'
  'apps/web/src/components/settings/AddProviderInstanceDialog.tsx:environment: bedrockEnvironmentForSave\(bedrockEnvironment\)'
  # WI-1.02: the shared redactor applies at log, feedback and webhook-prompt egress.
  'packages/shared/package.json:"\./redaction"'
  'apps/server/src/serverLogger.ts:redactingSecrets\(redactingCredentials\(Logger\.consolePretty\(\)\)\)'
  'apps/server/src/feedback/scrubFeedback.ts:\.\.\.SECRET_PATTERNS,'
  'apps/server/src/scheduledTasks/webhookTemplate.ts:expression\.includes\("\."\) \? text : redactSecrets\(text\)'
  # WI-1.10: new threads start on the default environment; the composer says when it is offline.
  'apps/web/src/components/Sidebar.tsx:startNewThreadFromContext, +\} from "\.\./fork/defaultThreadEnvironment"'
  'apps/web/src/components/Sidebar.tsx:handleNewThread\( *preferDefaultThreadEnvironment\('
  'apps/web/src/components/CommandPalette.tsx:startNewThreadFromContext, +\} from "\.\./fork/defaultThreadEnvironment"'
  'apps/web/src/components/CommandPalette.tsx:handleNewThread\( *preferDefaultThreadEnvironment\('
  'apps/web/src/shortcuts/chatRouteCommands.ts:import \{ startNewThreadFromContext \} from "\.\./fork/defaultThreadEnvironment"'
  'apps/web/src/routes/_chat.index.tsx:handleNewThread\(preferDefaultThreadEnvironment\(projectRef\)'
  'apps/web/src/components/ChatView.tsx:useForkComposerBannerItems\('
  'apps/web/src/components/ChatView.tsx:\.\.\.forkComposerBannerItems,'
  'apps/web/src/components/settings/ProjectDefaultsSettings.tsx:<DefaultThreadEnvironmentRow />'
  'apps/web/src/components/settings/settingsSearch.ts:\.\.\.FORK_SETTINGS_SEARCH_ITEMS,'
  # WI-1.03: the audit log's CLI, Diagnostics viewer and event hooks.
  'apps/server/src/binCli.ts:import \{ auditCommand \} from "\./fork/audit/auditCommand\.ts";'
  'apps/server/src/binCli.ts:auditCommand,'
  'apps/server/src/auth/http.ts:import \* as AuditLog from "\.\./fork/audit/AuditLog\.ts";'
  'apps/server/src/auth/http.ts:if \(approved\) yield\* AuditLog\.notePairingApproved\(args\.payload\.pairingLinkId\);'
  'apps/server/src/secrets/SecretRequests.ts:import \* as AuditLog from "\.\./fork/audit/AuditLog\.ts";'
  'apps/server/src/secrets/SecretRequests.ts:yield\* AuditLog\.noteSecretReveal\("ref", input\.projectId\);'
  'apps/server/src/secrets/SecretRequests.ts:yield\* AuditLog\.noteSecretReveal\("file", input\.threadId\);'
  'apps/web/src/components/settings/DiagnosticsSettings.tsx:import \{ AuditLogSection \} from "~/fork/AuditLogSection";'
  'apps/web/src/components/settings/DiagnosticsSettings.tsx:<AuditLogSection environmentId=\{environmentId\} />'
  # WI-1.06: workflow files load only once their exact bytes are approved; workflows default on (A2).
  'apps/server/src/workflows/WorkflowRuntime.ts:import \* as WorkflowTrust from "\.\./fork/workflowTrust/WorkflowTrust\.ts";'
  'apps/server/src/workflows/WorkflowRuntime.ts:const trust = yield\* WorkflowTrust\.WorkflowTrust;'
  'apps/server/src/workflows/WorkflowRuntime.ts:const loaded = yield\* trust\.gated\(file, source\.value, \(from\) => load\(from, name\)\);'
  'apps/server/src/workflows/WorkflowRuntime.ts:yield\* trust\.record\(directory, name, source, "user"\);'
  'apps/server/src/workflows/WorkflowRuntime.ts:yield\* WorkflowTrust\.onApproved\(directory, seen, lock\.withPermits\(1\)\(reload\(\)\)\);'
  'apps/server/src/workflows/WorkflowRuntime.test.ts:WorkflowTrustTestkit\.make\(gated, database\)'
  'apps/server/src/workflows/WorkflowRuntime.test.ts:a file in the folder is not imported until its exact bytes are approved'
  'apps/server/src/orchestration-v2/runtimeLayer.ts:import \* as WorkflowTrust from "\.\./fork/workflowTrust/WorkflowTrust\.ts";'
  'apps/server/src/orchestration-v2/runtimeLayer.ts:Layer\.provideMerge\(WorkflowTrust\.layer\)'
  'apps/server/src/persistence/ForkSchema.ts:yield\* ensureWorkflowTrustSchema\(\)'
  'packages/contracts/src/settings.ts:workflowsEnabled: Schema\.Boolean\.pipe\(Schema\.withDecodingDefault\(Effect\.succeed\(true\)\)\)'
  'apps/web/src/components/workflows/WorkflowsPage.tsx:import \{ WorkflowApprovals \} from "~/fork/WorkflowApprovals";'
  'apps/web/src/components/workflows/WorkflowsPage.tsx:<WorkflowApprovals key=\{environmentId\} environmentId=\{environmentId\} />'
  # WI-1.04: fork alerts reach the open app, and notification channels show in Settings > General.
  'packages/client-runtime/src/rpc/client.ts:type CmdeckSubscriptionRpcTag,'
  'packages/client-runtime/src/rpc/client.ts:\| CmdeckSubscriptionRpcTag;'
  'apps/web/src/appInit.tsx:import \{ startForkAlertNotifications \} from "\./fork/forkAlertNotifications";'
  'apps/web/src/appInit.tsx:startForkAlertNotifications\(\);'
  'apps/web/src/components/settings/SettingsPanels.tsx:import \{ NotificationChannelsSection \} from "~/fork/NotificationChannelsSection";'
  'apps/web/src/components/settings/SettingsPanels.tsx:<NotificationChannelsSection />'
  # WI-1.03: remote MCP tokens changed from the CLI are audited too.
  'apps/server/src/cli/auth.ts:AuditLog\.layerAtDatabase\(config\.dbPath\),'
  # WI-1.03: a pairing approved from the CLI without a server is audited too.
  'apps/server/src/cli/auth.ts:Effect\.tap\(AuditLog\.notePairingApprovedLocally\(flags\.id\)\)'
  'apps/server/src/cli/auth.ts:Effect\.tap\(AuditLog\.notePairingApprovedLocally\(pairingLinkId\)\)'
  # Memory (WI-1.07): fork services orchestration reads, and the turn-context block in the provider prompt.
  'apps/server/src/server.ts:Layer\.provideMerge\(ForkLayer\.layerBeneathOrchestration\)'
  'apps/server/src/orchestration-v2/ProviderTurnStartService.ts:import \* as TurnContext from "\.\./fork/memory/TurnContext\.ts";'
  'apps/server/src/orchestration-v2/ProviderTurnStartService.ts:const forkTurnContext = yield\* TurnContext\.forProviderTurnStart;'
  'apps/server/src/orchestration-v2/ProviderTurnStartService.ts:const forkContext = yield\* forkTurnContext\('
  'apps/server/src/orchestration-v2/ProviderTurnStartService.ts:const carriesPendingContext = +forkContext !== "" \|\|'
  'apps/server/src/orchestration-v2/ProviderTurnStartService.ts:const context = \[ +compact \? "" : forkContext,'
  # WI-2.14: usage alert state table, and the thresholds row beside Usage providers.
  'apps/server/src/persistence/ForkSchema.ts:yield\* ensureUsageAlertsSchema\(\)'
  'apps/web/src/components/settings/ProviderSettingsPanel.tsx:import \{ UsageAlertsSection \} from "~/fork/UsageAlertsSection";'
  'apps/web/src/components/settings/ProviderSettingsPanel.tsx:<UsageAlertsSection environmentId=\{environmentId\} settings=\{settings\} readOnly=\{readOnly\} />'
  # Open beside: an unrelated project's thread never runs code blocks in the host's terminal,
  # and a thread hidden by a tag filter leaves the panel.
  'apps/web/src/components/ChatView.tsx:activeThread\?\.projectId !== panelHostShell\?\.projectId'
  'apps/web/src/components/chat/SideThreadPane.tsx:useCloseWhenHidden\(threadRef, props\.onClose\)'
  # WI-2.17: secrets at rest. The desktop app hands the key over in the bootstrap envelope.
  'packages/contracts/src/desktopBootstrap.ts:cmdeckSecretsKey: Schema\.optionalKey\(Schema\.String\)'
  'apps/server/src/config.ts:readonly cmdeckSecretsKey\?: Redacted\.Redacted<string> \| undefined;'
  'apps/server/src/cli/config.ts:cmdeckSecretsKey: Redacted\.make\(bootstrap\.cmdeckSecretsKey\)'
  'apps/server/src/auth/serverInternalPaths.ts:isWithinRoot\(path, file, path\.join\(path\.dirname\(stateDir\), "keys"\)\)'
  'apps/desktop/src/main.ts:Layer\.provideMerge\(DesktopSecretsKey\.layer\)'
  'apps/desktop/src/backend/DesktopBackendConfiguration.ts:const secretsKey = yield\* DesktopSecretsKey\.DesktopSecretsKey;'
  'apps/desktop/src/backend/DesktopBackendConfiguration.ts:Effect\.flatMap\(DesktopSecretsKey\.withSecretsKey\(secretsKey, environment\.baseDir\)\)'
  # WI-2.10: scheduled tasks start new threads on the decision service's routed model.
  'apps/server/src/scheduledTasks/ScheduledTaskService.ts:modelSelection: yield\* Decisions\.routeScheduledTask\(active\),'
  # WI-2.21: design-critique eval cases load the repo skill they test.
  'evals/mcp-tool-use/run.ts:skill: Schema\.optional\(Schema\.String\),'
  'evals/mcp-tool-use/run.ts:: invokedSkillPrompt\('
)
# 6. Only a person approves a workflow file: no MCP tool may reach the trust gate (WI-1.06).
hits="$(git grep -l -E 'WorkflowTrust|workflowTrust' -- apps/server/src/mcp apps/server/src/fork/mcpToolkits.ts)"
[ -z "$hits" ] || bad "MCP code reaches the workflow trust gate: $hits"

# 7. WI-2.17: a file that builds the secret store must build the encrypting one, or it reads and
#    writes envelopes as raw bytes. Its `ServerSecretStore` import names the fork module instead.
for file in $(git grep -l -E 'ServerSecretStore\.layer([^A-Za-z]|$)' -- apps/server/src ':!apps/server/src/fork/**' ':!**/*.test.ts' ':!**/*.testkit.ts' ':!**/testkit/**'); do
  grep -q -E '^import \* as ServerSecretStore from "(\./|(\.\./)+)fork/secrets/EncryptedSecretStore\.ts";' "$file" ||
    bad "$file builds ServerSecretStore.layer without fork/secrets/EncryptedSecretStore.ts"
done

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
