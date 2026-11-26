# CMDeck fork audit

- Repo: `Tehcnological/cmdeck`, `main` @ `4a2f27d590` (release `v3`, 3.0.0). Audited 2026-11-26.
- Merge base with `pingdotgg/t3code` `main`: `9ea5044aef` (upstream v0.1.12, 2026-11-25). CMDeck is 339
  commits ahead and upstream is 324 ahead (upstream `main` @ `9b4943f91c`).
- Diff from the merge base: 1,328 files, +83,610 / −73,866. That breaks down as 163 added, 115 deleted,
  1,048 modified and 2 renamed. Translation catalogs account for 30 files and about 74k of the changed
  lines, because the rename re-keyed them.
- `scripts/fork/guard.sh` **passes** at HEAD, compared against `upstream/main`.
- Method: `git log`/`git diff` against the merge base, reading the source of every fork module, `gh pr list`,
  and checking every `origin/*` branch. Outbound endpoints were classified by a sub-agent and I re-checked
  the highest-impact ones myself (favicon, desktop updates, Claude usage). Anything not read in source is
  marked **(inferred)**.

## 1. Fork inventory

The history has three layers:

1. **M3 Code history.** About 140 commits by Zuri, MiaAI-Lab and others (2026-11-07 to 11-20), merged in
   `5631bbe949` ("port M3's local-inference features onto upstream").
2. **PR #1 `private/fork-hardening`.** Squash-merged as `395d2c8843` "CMDeck v1"; its internal
   merge commits are still visible.
3. **PRs #6–#22**, merged 2026-11-25 to 11-26.

| Group                                  | What changed                                                                                                                                                                                                                                                                                                                                                                                                            | Key files / symbols                                                                                                                                                                                                                                                                                                                                                                                              | Commits / PRs                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Privacy / telemetry removal**        | Deletes the analytics service, feature-usage, provider-usage analytics, OTLP/trace export, RPC instrumentation, `RunMetrics`, process-group resource telemetry, web client tracing, mobile `expo-observe`, mobile sourcemap upload, and the infra task-cache telemetry. Removes the `server.getTraceDiagnostics` and `server.checkOtlpEndpoint` RPCs. Agents CMDeck starts get telemetry opt-out environment variables. | Deleted: `apps/server/src/telemetry/*`, `apps/server/src/observability/*`, `packages/shared/src/{observability,otelEnvironment,telemetryId,relayTracing}.ts`, `apps/web/src/observability/*`, `apps/mobile/src/features/observability/*`. Opt-out env: `packages/provider-core/src/server/instanceEnvironment.ts` (`DO_NOT_TRACK`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `OPENCODE_DISABLE_TELEMETRY`) | `06295f53c2` (247 files, −17.7k), `2816d41168`, `0c3cc3866a`, `ad02097684` (PR #11) |
| **T3 Connect / relay removal**         | Cut at the boundary rather than deleted. `allowsConnect` always returns false, relay and Clerk config always fail, and `hasCloudPublicConfig` is false. The agent-activity relay is a no-op and the held-hooks waker is deleted. The Connect code itself stays for clean merges.                                                                                                                                        | `apps/server/src/policy/managedLimits.ts` `allowsConnect`; `apps/server/src/cloud/publicConfig.ts` `relayUrlConfig`, `cloudCliOAuthConfig`, `hasCloudPublicConfig`; `apps/web/src/cloud/publicConfig.ts` `resolveCloudPublicConfig`; `apps/server/src/relay/AgentAwarenessRelay.ts`                                                                                                                              | `51905decad`, `dc2788bb52`                                                          |
| **Identity / rename**                  | CMDeck name, `~/.cmdeck` / `CMDECK_HOME`, app ID `com.tehcnological.cmdeck`, service `cmdeck`, port 3783, `cmdeck` CLI shim, and a placeholder icon. Model-facing text, wire identifiers and `t3code://` are deliberately left as upstream's.                                                                                                                                                                           | `packages/shared/src/appIdentity.ts` (`APP_DISPLAY_NAME`, `APP_HOME_DIR_NAME`, `applyAppHomeEnv`, `APP_RELEASE_OWNER/REPO`, `DEFAULT_SERVER_PORT`); `docs/operations/fork-upstream-sync.md` "Renamed in this fork"                                                                                                                                                                                               | `4d6ff43309`, `d85a4195e5` (598 files), `e7da796705`, `1bf499ed4a` (PR #8)          |
| **Shared-data safeguards**             | Alerts when the official T3 Code has touched shared data. `.cmdeck` runtime marker. Never reuses an official runtime.                                                                                                                                                                                                                                                                                                   | `apps/server/src/fork/ForkAlerts.ts` (`configIssues`, `fork.shared-data`), `apps/server/src/fork/forkRuntimeMarker.ts`, `apps/web/src/components/ForkSharedDataToast.ts`                                                                                                                                                                                                                                         | `d2b360167b`, `7e23506ed6`                                                          |
| **Migration / import**                 | `cmdeck import-from-t3` (plan / dry-run / run), plus a one-time import offer toast                                                                                                                                                                                                                                                                                                                                      | `apps/server/src/fork/T3Import.ts`, `apps/server/src/cli/importFromT3.ts`, `apps/web/src/components/ForkImportOfferToast.ts`                                                                                                                                                                                                                                                                                     | `e3acff86ad`, `26b3612d5a`, `2948bc2786`                                            |
| **Remote access**                      | Remote MCP bearer tokens (off by default). Cloudflare Tunnel address in Settings with a public-address check. Direct pairing held until a device is approved (on by default). Mesh VPN / WireGuard address advertising. Tailscale docs.                                                                                                                                                                                 | `apps/server/src/auth/RemoteMcpTokens.ts`, `apps/server/src/environment/PublicAddressCheck.ts`, `apps/web/src/components/settings/RemoteAccessSettings.tsx`, `apps/server/src/auth/PairingGrantStore.ts`, `apps/server/src/persistence/AuthPairingRequests.ts`, `apps/desktop/src/backend/DesktopServerExposure.ts`                                                                                              | `bc88bb7cf4`, `265f3e742a`, `8b51f2a348`, `4e2cc342a9`                              |
| **E2EE (M3 port)**                     | Opt-in encrypted WebSocket RPC (`e2eeMode` defaults to off). Transport classification. Attachment bytes travel inside the encrypted socket.                                                                                                                                                                                                                                                                             | `packages/shared/src/socketE2ee.ts`, `apps/server/src/auth/ServerE2eeIdentity.ts`, `apps/server/src/auth/transportSecurity.ts`, `apps/server/src/assets/AssetTransfer.ts`, `apps/web/src/assets/encryptedAssetSrc.ts`                                                                                                                                                                                            | `2615f5e5a0` (PR #13), `2886864dda`, `d70185840c` (PR #19)                          |
| **Local inference (M3 port)**          | Inference server registry, discovery, gateway with admission and queue, watchdog, image checks, usage, request log, and the Settings → Inference UI. Pi, OpenCode and Codex can be linked to a gateway server. Mobile has read-only inference screens.                                                                                                                                                                  | `apps/server/src/inference/*` (~20 modules), `packages/contracts/src/inference.ts`, `packages/provider-core/src/server/inferenceGateway.ts`, `packages/provider-{pi,opencode}/src/server/gateway.ts`, `apps/server/src/provider/codexGateway.ts`, `inference_requests` in `ForkSchema.ts`                                                                                                                        | `5631bbe949`, PR #11                                                                |
| **Providers / integrations (M3 port)** | Oh My Pi (OMP) as a Pi flavor. LLM Gateway text generator. Vikunja issue tracker. Gitea `gt` CLI preferred over `tea`. Antigravity runs as the plain official CLI, with no quota probing and no faked SSH.                                                                                                                                                                                                              | `packages/provider-omp`, `packages/issue-tracker-vikunja`, `apps/web/src/textGenerators.ts`, `packages/source-control-forgejo/src/server/ForgejoCli.ts`, `apps/server/src/provider/acp/AntigravityAcpSupport.ts`                                                                                                                                                                                                 | PR #15, `62e460dc76`, `342b047c11`, `bd092bd695`                                    |
| **Dev workflows**                      | Batched diff comments. Pull-request watch wakes quote the failing CI logs. Second-model review from the UI and through the `t3_thread_review` MCP tool.                                                                                                                                                                                                                                                                 | `apps/web/src/components/diffs/DiffCommentBatchBar.tsx`; `apps/server/src/orchestration-v2/pullRequestWatch.ts`; `apps/server/src/review/ThreadReview.ts`, `apps/server/src/mcp/toolkits/review/*`, `packages/contracts/src/threadReview.ts`                                                                                                                                                                     | `bc7fe48b7b`, `6755770c27`, `57ecdb7fff`, `1b07d70eb6`, `82ef917b1c`                |
| **Desktop**                            | Close to tray and launch at login. Auto-update from CMDeck releases, with a Beta channel. macOS bundle updater. Complete uninstall that removes only CMDeck's files.                                                                                                                                                                                                                                                    | `apps/desktop/src/window/DesktopTray.ts`, `apps/desktop/src/updates/{CmdeckGitHubProvider,MacBundleUpdater}.ts`, `packages/shared/src/uninstallPlan.ts`, `apps/desktop/src/app/DesktopUninstall.ts`, `apps/server/src/cli/uninstall.ts`                                                                                                                                                                          | `378bcd2998`, `2b3025ae17` (PR #10), `a08333ed6b` (PR #20), `6ed6e82541` (PR #12)   |
| **Performance (M3 port)**              | SQLite cache and mmap, with a network-drive guard. Bounded secret refresh. V8 compile cache.                                                                                                                                                                                                                                                                                                                            | e.g. `T3CODE_SQLITE_MMAP_BYTES`                                                                                                                                                                                                                                                                                                                                                                                  | `e622fc2df6` (PR #14)                                                               |
| **UI (M3 port)**                       | Settings in eight destinations, sidebar New project, Add project dialog (pick a machine, then a folder), dark-gray Dark theme, Done list                                                                                                                                                                                                                                                                                | `apps/web/src/components/settings/SettingsPanels.tsx`, `apps/web/src/components/AddProjectDialog.tsx`                                                                                                                                                                                                                                                                                                            | `7bbbf1fbbc`, `8bc3950626`, `50fae2fa50` (partly reverted in `6eb7d88746`)          |
| **CI / release**                       | 31 upstream workflows deleted, including `ci.yml`, `release*.yml`, mobile EAS, relay and `windows-tests.yml`. Four `fork-*.yml` added: guard, typecheck, lint/knip/i18n, sharded tests, unsigned Windows/macOS-arm64/Linux-x64 installers, and `vN` tag releases.                                                                                                                                                       | `.github/workflows/fork-{ci,desktop-build,release,fixups}.yml`, `scripts/fork/{guard,sync-upstream,render-placeholder-icons}.sh`                                                                                                                                                                                                                                                                                 | `e568db5d3b`, PRs #6, #7, #17, #21, #22                                             |
| **Fork-only schema**                   | Fork tables are kept out of the numbered migrations                                                                                                                                                                                                                                                                                                                                                                     | `apps/server/src/persistence/ForkSchema.ts` `ensureForkSchema` (`inference_requests`, `auth_pairing_requests`). `Migrations.ts` has 2 lines changed.                                                                                                                                                                                                                                                             | —                                                                                   |

## 2. CMD requirement status (verified in source)

Counts: **Implemented+tested 7**, **Implemented 6**, **Partial 6**, **Absent 4**. The per-item evidence
is in `cmdeck-fork.csv`.

| ID     | Status                | Verdict and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMD-01 | Partial               | All telemetry, analytics, crash and trace code is gone (deleted, not stubbed), and the guard blocks it from coming back. Avoidable outbound calls still exist, though; see §3. The worst is that Google s2 favicons are fetched for every linked hostname, with no toggle. No automated egress test exists.                                                                                                                                                                                                             |
| CMD-02 | Implemented           | Connect is unreachable: `allowsConnect = false`, `relayUrlConfig = Config.fail(...)`, and nothing writes `RELAY_URL_SECRET`. Dead code is retained (`apps/server/src/cloud/CloudLink.ts`, `ManagedEndpointRuntime.ts`, `packages/client-runtime/src/relay/managedRelay.ts`, the Clerk components). Remote access still works over LAN, Tailscale and your own tunnel. **Bug on `main`:** "Use in another app (MCP)" crashes on Clerk `useAuth`; open PR #23 fixes it. Relay push / Live Activities for mobile are gone. |
| CMD-03 | Implemented           | `packages/tailscale` (`t3 serve --tailscale-serve`, Serve HTTPS) is inherited from upstream. The fork adds docs, pairing hints and mesh-VPN address advertising (`DesktopServerExposure.ts`).                                                                                                                                                                                                                                                                                                                           |
| CMD-04 | Partial               | The tunnel is entirely user-run (`docs/user/cloudflare-tunnel.md`). CMDeck only stores and checks its address (`PublicAddressCheck.ts`, `server.checkPublicAddress`). The server does not validate `Cf-Access-Jwt-Assertion` (not found anywhere), so Access protects only at the edge and CMDeck's own auth does the rest. The docs state that the official mobile apps cannot pass Access.                                                                                                                            |
| CMD-05 | Implemented+tested    | `/mcp` with OAuth comes from upstream. The fork adds `RemoteMcpTokens` bearer tokens (`t3mcp_`), off by default (`remoteMcpEnabled` / `T3CODE_REMOTE_MCP`). Revoking a token closes its open requests. Tests: `RemoteMcpTokens.test.ts`.                                                                                                                                                                                                                                                                                |
| CMD-06 | Implemented           | No CMDeck service exists. The only CMDeck-hosted resources are files and releases in the GitHub repo.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| CMD-07 | Implemented+tested    | M3 inference stack: generic OpenAI/Responses-compatible servers (Ollama, LM Studio, llama.cpp, vLLM), discovery limited to localhost ports and addresses the user entered, a gateway, and a watchdog. Codex on a local server is labelled Experimental (`localModelSetup.logic.ts`).                                                                                                                                                                                                                                    |
| CMD-08 | Partial               | Desktop installers exist only for Windows x64, macOS arm64 and Linux x64, all unsigned. There is no macOS x64 or Linux arm64 build. **Releases carry no CLI archives** (`fork-release.yml` checks only for desktop assets), and `CLI_RELEASE_DEFAULT_BASE_URL` points at `…not-set.invalid`. Headless installs and self-update therefore need a mirror you host. Fork CI runs tests on Linux only.                                                                                                                      |
| CMD-09 | Absent                | `docker` appears only in network-interface filters (`startupAccess.ts:53`, `DesktopServerExposure.ts:88`). The only sandboxing is the harness permission modes (`packages/contracts/src/providerPolicy.ts`).                                                                                                                                                                                                                                                                                                            |
| CMD-10 | Absent                | Nothing found for WindowsSandbox, `.wsb`, AppContainer, sandbox-exec, bwrap or landlock.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CMD-11 | Implemented (harness) | OpenCode, ACP Registry and local ACP commands are inherited from upstream. **goose has no dedicated provider.** It runs as a generic ACP agent, either from the Registry or as a local command, and `packages/provider-acp/src/server/runtimeModel.ts:1166` handles goose's `_meta` (tested in `runtimeModel.test.ts`). The fork adds OMP.                                                                                                                                                                              |
| CMD-12 | Partial               | Upstream SSH environments and peer links are kept, and the Add project dialog can pick a machine. **M3's "desktop uploads its own runtime over SSH" (`8a6e96e5d4`, `localArchiveDir`) did not survive the merge** (`git grep localArchiveDir` finds nothing). SSH bootstrap (`packages/ssh/src/tunnel.ts:497-558`) downloads from `T3CODE_RELEASE_BASE_URL` and fails closed without a mirror.                                                                                                                          |
| CMD-13 | Implemented+tested    | `DesktopTray.ts` (close to tray on by default, launch at login) and `DesktopTrayPolicy.ts`, with tests. The background service is upstream's, renamed `cmdeck`.                                                                                                                                                                                                                                                                                                                                                         |
| CMD-14 | Implemented+tested    | `DiffCommentBatchBar.tsx` (count, Send, Clear, edit) plus `DiffCommentBatchBar.browser.test.tsx`. Web and desktop only.                                                                                                                                                                                                                                                                                                                                                                                                 |
| CMD-15 | Implemented+tested    | `pullRequestWatch.ts` quotes failing-check log tails: at most 3 checks, 1,500 characters each, fenced and marked untrusted, with a 20 s timeout. Upstream `ci_logs` and `ci_rerun` are retained. It is opt-in, because it applies only to PRs you watch.                                                                                                                                                                                                                                                                |
| CMD-16 | Implemented+tested    | `ThreadReview.start` runs a reviewer in a tagged side chat, never with full access and capped by the caller's `DispatchModeLimit`. The diff is truncated at 200k characters. It is available as an RPC, from the command palette and diff panel, and through the `t3_thread_review` MCP tool, and it has evals.                                                                                                                                                                                                         |
| CMD-17 | Implemented           | `vcs/*` and `source-control-*` are inherited. The fork's edits there are metrics removal (e.g. `GitVcsDriverCore.ts`) and Gitea `gt`.                                                                                                                                                                                                                                                                                                                                                                                   |
| CMD-18 | Implemented           | Orchestration is upstream's at v0.1.12. Protocol version 2 matches `upstream/main` (guard). Syncing the 324 newer upstream commits is the upstream agent's lane.                                                                                                                                                                                                                                                                                                                                                        |
| CMD-19 | Implemented+tested    | `T3Import.plan/run` uses rule tables (`STATE_RULES`, `BASE_RULES`), a consistent SQLite snapshot, identity-row removal (`IDENTITY_TABLES`) and secret filtering (`isInstallSecret`). It refuses a newer schema and has a dry run. Tests: `T3Import.test.ts`.                                                                                                                                                                                                                                                            |
| CMD-20 | Absent                | See §2.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CMD-21 | Absent                | No importer for other agent environments. Upstream has only browser-cookie import and the V1→V2 thread migration.                                                                                                                                                                                                                                                                                                                                                                                                       |
| CMD-22 | Partial               | See §2.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CMD-23 | Partial               | The same web app is served by the server. `manifest.webmanifest` is `standalone`, and the layout is upstream's responsive one (45 components use mobile breakpoints or media queries). **No service worker** (offline, web push or install prompt). Works in a browser behind Access (docs).                                                                                                                                                                                                                            |

### 2.1 Is `T3Import` extensible for a Kiro Crew importer?

Only partly. `T3Import` copies files between two installs that share a schema. Each top-level
entry in the data folder gets `copy`, `transform` or `skip`, and the SQLite file is snapshotted and then
scrubbed. It cannot map foreign records. The reusable parts are:

- the `ImportPlan` / `ImportItem` shape and the plan → dry-run → run flow with backups;
- the CLI wiring (`binCli.ts` `importFromT3Command`);
- the one-time offer config issue (`importOfferIssues` → `fork.import-available` → toast).

A Kiro Crew import would need to translate records into threads, projects and messages.
Upstream's `apps/server/src/orchestration-v2/legacy/LegacyV1ThreadImporter.ts` (836 lines, with
integration tests) already does that kind of translation, so the least disruptive design is **(inferred)**:
an `Importer` per source that produces an `ImportPlan`, where the Kiro source writes through
orchestration or projection services the way `LegacyV1ThreadImporter` does, instead of copying files.

Known limits: the T3 walkers are synchronous (a `shortcut:` comment at `T3Import.ts:159`), and the source
and target are hard-wired to `~/.t3` and this build's folder (`T3Import.ts:541`).

### 2.2 Official mobile app compatibility

Verified in source:

- `ORCHESTRATION_PROTOCOL_VERSION = 2` matches upstream; `guard.sh` check 1 enforces this.
- Pairing over LAN or Tailscale needs no Connect.
- Fork RPCs are additive. The two removed RPCs (trace diagnostics, OTLP check) are not referenced by
  `apps/mobile/src` at the merge base.
- Approval of direct pairing reuses the `connect_approval_pending` 403 over `/oauth/token`, tested in
  `packages/client-runtime/src/connection/onboarding.test.ts`.

Limits:

- Agent-awareness push notifications and Live Activities depended on the relay. They are gone
  (`AgentAwarenessRelay` is a no-op).
- The official app cannot get past Cloudflare Access, so phones must use Tailscale.
- Second-model reviews appear in the app as plain side chats.

**Not verified:** a real store build of the official app against CMDeck. Note also that
`ba004a8f06` said the mobile pairing path had "no pending-approval retry", while `8b51f2a348`, a few
hours later, says the official app handles it. The client-runtime test supports the later claim, but
only a device test would settle it.

**Privacy outside CMDeck's control (inferred from upstream code at the merge base):** the official
app bundles `expo-observe` (crash reports sent "only through the relay"), `expo-updates`, and
upstream release checks against `pingdotgg/t3code` (`docs/user/telemetry.md`).

## 3. Remaining outbound endpoints (apps/server, apps/desktop, apps/web)

**Automatic, with no opt-in** (the real phone-home set):

| Endpoint                                                                                                                                                                     | Where                                                                                                                                               | Trigger                                                                                                        | Off switch                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `api.github.com/repos/Tehcnological/cmdeck/releases`                                                                                                                         | `apps/desktop/src/updates/DesktopUpdates.ts` `startUpdatePollers`:1077, `CmdeckGitHubProvider.ts`                                                   | 15 s after launch, then every 4 h. Checks only; auto-download is off.                                          | `T3CODE_DISABLE_AUTO_UPDATE` or managed policy `updates.mode` only. **No Settings toggle.** |
| `raw.githubusercontent.com/Tehcnological/cmdeck/main/.../model-manifest.json`                                                                                                | `apps/server/src/provider/ModelManifest.ts:29`                                                                                                      | Provider checks (startup, then every 5 min, cached 1 h)                                                        | `enableProviderUpdateChecks` (on by default)                                                |
| `registry.npmjs.org/<pkg>/latest`, `downloads.claude.ai`, `releases.openai.com`, Meta (Muse), `releases.fx.sh`, the Antigravity `run.app` manifest, `storage.googleapis.com` | `provider-core maintenanceResolver.ts:1509`, `ClaudeMaintenance.ts:21`, `CodexDriver.ts:107`, `CodexInstallation.ts:39`, `antigravityCliRelease.ts` | Version checks for providers that are enabled and installed                                                    | `enableProviderUpdateChecks`                                                                |
| `api.anthropic.com/api/oauth/usage` (using the user's Claude OAuth token)                                                                                                    | `apps/server/src/provider/claudeResetCredits.ts:216`                                                                                                | Every Claude provider check while signed in with a subscription                                                | None, short of disabling Claude                                                             |
| Grok and Cursor usage and catalog endpoints                                                                                                                                  | `provider-grok usageLimits.ts`, `provider-cursor`                                                                                                   | Provider checks while signed in **(inferred cadence)**                                                         | Disable the provider                                                                        |
| `www.google.com/s2/favicons?domain=<host>`                                                                                                                                   | `packages/shared/src/favicon.ts:81` `faviconUrlForOrigin` (unchanged from upstream); `MarkdownExternalLink.tsx`, `RightPanelTabs.tsx`               | Rendered in the client for every link in chat and every preview tab. **Sends each linked hostname to Google.** | None                                                                                        |
| `<site>/favicon.ico`, `github.githubassets.com`                                                                                                                              | `favicon.ts` `faviconUrlForPage`; `TimelineToolActivityIcon.tsx`                                                                                    | Rendering website tool activity                                                                                | None                                                                                        |
| Project git remotes                                                                                                                                                          | `apps/server/src/vcs/VcsAutomaticFetchInterval.ts`                                                                                                  | `git fetch` every 30 s on the balanced profile **(inferred: viewed repos)**                                    | `automaticGitFetchInterval=0` or the battery-saver profile                                  |
| Linux only: Electron spellcheck dictionaries from Google's CDN                                                                                                               | No spellcheck configuration anywhere in `apps/desktop`                                                                                              | Electron default **(inferred)**                                                                                | None                                                                                        |

**Feature-configured or user-initiated:**

- **ACP Registry CDN** (`cdn.agentclientprotocol.com`): contacted only when a Registry instance exists, or
  when you search or install (`provider-acp-registry driver.ts:855` `hasRegistryAgent`).
- **LiteLLM prices** (`UsageService.ts:73-75`): only when Usage is opened, cached for 24 h. No switch.
- **open-vsx.org**: theme search.
- **huggingface.co**: local voice model download.
- **Cloud speech** (OpenAI, xAI, OpenRouter): only with an API key.
- **Text generators** (OpenAI, Anthropic, OpenRouter, LLM Gateway): only when configured.
- **chrome-headless-shell** from `storage.googleapis.com`: on first use of the server browser.
- **api.expo.dev**: only with an Expo token.
- **Forge APIs** (GitHub, GitLab, Bitbucket, Linear, Vikunja): only with credentials.
- **Codex managed auth** (`auth.openai.com`).
- **cliproxy usage sources**: only when configured.
- **Cloudflare reachability probe** (`1.1.1.1`, `argotunnel.com`): only with a tunnel config.
- **The user's tunnel URL**: `checkPublicAddress`.
- **Provider install scripts**: when you click install.
- **Inference discovery**: localhost and addresses you enter, on request, with no subnet sweep.

**T3-operated endpoints that are still reachable, both only on explicit command:**

- `t3 update` lists `api.github.com/repos/pingdotgg/t3code/releases`
  (`packages/shared/src/cliRelease.ts:6,156`), then fails at the `.invalid` download base.
- `t3 triage` tells the agent to fetch `raw.githubusercontent.com/pingdotgg/t3code/main/.github/triage/PLAYBOOK.md`
  (`apps/server/src/triage/triagePrompt.ts:37`). That is upstream-controlled text steering an agent.

The relay, `app.t3.codes` and `nightly.app.t3.codes` appear only as dead config or strings.

**Gaps against brief §10:**

- No privacy regression test for egress.
- The favicon leak and the Claude usage poll have no switch.
- The desktop update poll has no in-app switch.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is not set for Claude.
- The opt-out environment applies only when no `baseEnv` is passed (`instanceEnvironment.ts:22`).

## 4. Unfinished branches and work

| Branch                                                                                                                                                                                                                                                                                                                                                                                                                                               | State                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/settings-copy-and-mcp-button` (PR #23, **OPEN**)                                                                                                                                                                                                                                                                                                                                                                                                | 2 commits ahead of main (`36f945487d`, `9e5d069108`). Hides the Connect-only MCP wizard, which **crashes on main**, and guest links. Fixes "T3 home" / "T3 tools" copy and says agent feedback stays local. Remote MCP lists every reachable address. **Pending; should merge.** |
| `feat/e2ee-attachments`, `feat/auto-updates-v2`, `feat/complete-uninstall`, `feat/e2ee`, `feat/beta-channel`, `feat/m3code-integrations`, `feat/about-version-readme`, `perf/m3code-startup-sqlite`, `port/m3code-fixes`, `chore/license-copyright`, `ci/shard-server-tests`, `ci/windows-build-fixes`, `ci/windows-installer-build`, `fix/desktop-cmdeck-command`, `fix/release-stray-feed-check`, `release/v3`, `upstream-sync/2026-11-25-9ea5044` | All **merged** (0 commits ahead of main; PRs #6–#22 MERGED). These are stale remote branches and can be deleted.                                                                                                                                                                 |
| PRs #2–#5                                                                                                                                                                                                                                                                                                                                                                                                                                            | Closed: Dependabot bumps (#2, #3) and bisect probes (#4, #5).                                                                                                                                                                                                                    |

Markers in fork-added code (no TODO or FIXME found):

- `T3Import.ts:159`: synchronous walkers.
- `T3Import.ts:541`: hard-wired source and target.
- `DesktopTray.ts:183`: macOS template icon.
- SQLite network-drive detection checks path names only.

Codex-on-local is labelled Experimental (`codexGateway.ts:250`).

**Lost M3 work:** the SSH runtime upload described in CMD-12.

## 5. Merge-burden hotspots

Of the modified upstream files (excluding tests, translations and images):

- 319 changed by 5 lines or fewer, mostly the rename;
- 256 changed by 6–30 lines;
- 147 changed by more than 30 lines.

**240 fork-modified files have also changed upstream since the merge base**, plus 20 translation
catalogs. In addition, upstream edited **12 files the fork deleted**, which will be modify/delete
conflicts: `observability/{Metrics,Observability,RpcInstrumentation}.ts`,
`telemetry/AnalyticsService*.ts`, `antigravityUsageLimits*.ts`, `cli/trace*.ts`,
`packages/shared/src/observability*.ts` and `.github/workflows/release-desktop.yml`.

Largest overlapping files (fork lines changed: + / −):

- `apps/web/src/components/settings/DiagnosticsSettings.tsx`: 477 (telemetry UI removed)
- `apps/server/src/ws.ts`: 429 (E2EE, review, inference, remote MCP and asset RPCs)
- `apps/server/src/mcp/McpHttpServer.ts`: 273
- `apps/server/src/mcp/McpSessionRegistry.ts`: 244
- `apps/web/src/components/CommandPalette.tsx`: 234
- `apps/server/src/terminal/Manager.ts`: 175
- `packages/contracts/src/rpc.ts`: 162
- `apps/server/src/http.ts`: 161
- `packages/contracts/src/server.ts`: 157
- `apps/server/src/server.ts`: 151
- `ForgejoCli.ts`: 146
- `IssueService.ts`: 131
- `scripts/build-desktop-artifact.ts`: 126
- `provider-pi/src/server/adapter.ts`: 112
- `ChatComposer.tsx`: 107
- `CodexAdapterV2.ts`: 93
- `DesktopUpdates.ts`: 83

Largest fork-only rewrites of upstream files (likely conflicts once upstream touches them):

- `packages/client-runtime/src/relay/managedRelay.ts`: 442
- `provider-pi/src/server/driver.ts`: 346
- `apps/server/src/cli/uninstall.ts`: 296
- `DesktopCliCommand.ts`: 268
- `orchestration-v2/ProviderSessionManager.ts`: 203
- `packages/shared/src/serverSettings.ts`: 191
- `apps/server/src/cli/auth.ts`: 179
- `PairingGrantStore.ts`: 166

Main causes:

- **Telemetry was deleted inline** across about 247 files (metrics and span calls removed from upstream
  code), not replaced with a no-op layer.
- **The rename touched 598 files** and re-keyed every translation.
- **New RPCs were added straight into `ws.ts` / `rpc.ts`.**

Isolation patterns already in use, which should be extended:

- `apps/server/src/fork/` holds fork services.
- `ForkSchema.ts` keeps fork tables out of the numbered migrations.
- `appIdentity.ts` is the single home for identity constants, with upstream values kept beside them.
- `scripts/fork/guard.sh` checks forbidden patterns, required hooks, protocol and migration parity, and
  the release feed.
- Additive `fork.*` server config issues are ignored by official clients.
- Connect is disabled at the boundary (`allowsConnect`, `Config.fail`) instead of being deleted.
- Model-facing text and wire identifiers are kept as upstream's.
- Fork features live in separate packages (`provider-omp`, `issue-tracker-vikunja`) and separate modules
  (`inference/*`, `review/*`, `mcp/toolkits/review`).

Recommendation **(inferred)**: for future removals, prefer no-op layers over inline deletion, and
move fork RPC handlers into a fork RPC group merged into `ws.ts` with one line.

## 6. Ledger entries (proposed log lines)

```
- 2026-11-26 [cmdeck] completed — Fork inventory at 4a2f27d590: 339 commits over 9ea5044aef (M3 history ~140, PR #1 squash, PRs #6–#22); guard.sh passes; see research/cmdeck-fork.md (high)
- 2026-11-26 [cmdeck] completed — CMD-01..23 verified: 7 Implemented+tested, 6 Implemented, 6 Partial, 4 Absent (CMD-09, CMD-10, CMD-20, CMD-21) (high)
- 2026-11-26 [cmdeck] completed — Telemetry code removed, not stubbed; remaining no-opt-in egress: desktop update poll (no UI toggle), model manifest + provider version checks (one toggle), Claude oauth/usage poll, Google s2 favicons for every linked host, git fetch every 30 s (high)
- 2026-11-26 [cmdeck] conflict — ba004a8f06 says official mobile cannot retry pending pairing; 8b51f2a348 says it can (client-runtime test agrees with the latter); needs a device test (medium)
- 2026-11-26 [cmdeck] completed — M3 SSH runtime upload (8a6e96e5d4) absent at HEAD; releases ship no CLI archives, so SSH remote/headless installs need T3CODE_RELEASE_BASE_URL mirror (high)
- 2026-11-26 [cmdeck] remaining — PR #23 open: MCP wizard crashes on main (Clerk useAuth) until merged (high)
- 2026-11-26 [cmdeck] decision-proposal — Kiro Crew importer should reuse T3Import's plan/dry-run/CLI/offer shell but map records like LegacyV1ThreadImporter, not copy files (medium, inferred)
- 2026-11-26 [cmdeck] completed — Merge burden: 240 fork-modified files also changed upstream; 12 modify/delete conflicts expected on next sync (high)
```

## 7. Open questions

1. Should the Google s2 favicon lookup be replaced (local fetch through the server, or off by default)?
   It is inherited, but it leaks every linked hostname.
2. Should the desktop update poll get a Settings switch, and should the Claude `oauth/usage` poll be
   optional?
3. Should releases publish CLI archives (`t3-<ver>-<platform>`) so that the background service, headless
   installs and SSH remotes work without a mirror? Or should M3's SSH upload be restored?
4. Does the official store mobile app (current version) pair with direct-pairing approval and run normally
   against CMDeck? This needs a device test. Losing push and Live Activities is accepted?
5. Should the Cloudflare Access JWT be verified server-side (defense in depth), and how should the PWA
   handle Access session expiry? No service worker exists.
6. goose: is generic ACP (Registry or local command) sufficient, or is a first-class provider wanted?
7. Should dead Connect code (`apps/server/src/cloud/*`, `managedRelay.ts`, Clerk UI) stay for merge
   hygiene (current choice) or be removed?
8. `t3 update` and `t3 triage` still point at `pingdotgg/t3code`. Should they be retargeted or
   removed?
