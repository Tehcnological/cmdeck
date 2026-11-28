# Upstream synchronization analysis (T3 Code → CMDeck)

Audit date 2026-11-26. Read-only: no merge, checkout or commit. Conflict prediction uses
`git merge-tree --write-tree HEAD upstream/main` (result tree `b250c97324`, never checked out).
Feature IDs follow `docs/audit/RESEARCH_LEDGER.md`; `T3-Uxx` = upstream-only feature, `EXC-Uxx` =
upstream change to exclude (the `U` keeps them apart from the CMDeck agent's `EXC-01..06`).

## Revisions

| Item                 | Value                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CMDeck HEAD          | `4a2f27d590` (`main`, v3 / 3.0.0)                                                                                                     |
| upstream/main        | `9b4943f91c` (2026-11-26 12:49 -0800)                                                                                                 |
| Merge base           | `9ea5044aef` (2026-11-25 10:32 -0800), brought in by fork PR #9 (`origin/upstream-sync/2026-11-25-9ea5044`, fully merged into HEAD)   |
| Divergence           | upstream +324 commits (`--first-parent` also 324: upstream is linear squash-merges); CMDeck +339 (18 first-parent merges, PRs #1–#22) |
| Diff size since base | upstream 1,002 files (+51,240/−22,713); CMDeck 1,328 files (+83,610/−73,866)                                                          |
| Latest stable        | `v0.1.13` → `bc0f04da94` (304 commits past base); `v0.1.12` `ca81b7b97a` is already in HEAD                                           |
| Latest nightly       | `v0.1.13-nightly.20261126.5305` → `bc0f04da94` (same commit as v0.1.13)                                                               |
| Release rhythm       | v0.1.10 11-16, v0.1.11 11-19, v0.1.12 11-24, v0.1.13 11-26; ~320 commits/day on main                                                  |
| Not yet fetched      | merged PRs #43751 (`f08bafe07f`), #43746 (`49a6653db6`)                                                                               |

## Commit themes

By type: 302 `fix`, 8 `feat`, 8 `perf`, 2 `chore`, 1 each `test`/`refactor`/`docs`/`build`. By
scope: web 98, server 77, shared 49, mobile 24, client-runtime 18, composer 6, scripts 5,
desktop 5, opencode 4, others ≤3. This window is a stabilization run, not a feature drop.

| Theme                                                                     | ~Count  | Examples                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown / file-link / thread-link / chip rendering                       | 53      | `cd414b81c1` #43301, `d9e28d4640` #43627, `9b4943f91c` #43738                                                                                                          |
| Copy, plurals, emoji truncation, i18n                                     | 29      | `57d886b41e` #43121, `2a99314a47` #43344, `f87ab0be1b` #43697                                                                                                          |
| Attachment text extraction (EPUB/DOCX/notebook/ZIP/ODS)                   | 26      | `539008aab9` #43095, `39eb396fae` #43290, `cf29ce760a` #43310                                                                                                          |
| Provider adapters (Claude, Codex, OpenCode, ACP, Antigravity, Pi, Cursor) | 31      | `923fe897d6` #43035, `1d015a3794` #43305, `4f04b70bf8` #43046                                                                                                          |
| Workflows and scheduled tasks                                             | 15      | `8987ba39d4` #42517 (feat), `4fd24866ab` #43139, `b996cf2067` #43255, `b0edd30be4` #43366                                                                              |
| Escape-key / right-panel sheet fixes                                      | 14      | `a8f708de96` #43118, `cb8b22cfa0` #43147                                                                                                                               |
| Mobile (Android/iPad, mobile app 2.4.0)                                   | 24      | `b972842270` #43210, `7deb51b550` (2.4.0 bump), `b99dab9495` #43610                                                                                                    |
| Security / permissions                                                    | 10      | `c4d0e05d96` #42535, `9fe3150799` #39489, `153671166c` #43043, `bed9141ec2` #43042, `82f22ef115` #42999, `972bae6a61` #43036, `5e9b58e809` #39408, `b5c725b27d` #43646 |
| Git / worktrees / source control                                          | 14      | `a8a64ce565` #43550, `0ccd7a886e` #43224, `411e49bd3f` #42428, `ab2348acbb` #43410                                                                                     |
| Performance                                                               | 8       | `abc0c4ae55` #42988, `ea3328c50c` #42671, `3d45d1d1ea` #43549, `3ed650f999` #43212                                                                                     |
| Benchmarks / dev tooling                                                  | 6       | `94af14b1f2` #42606, `eb9e8ae42f` #42975, `e057f7a770` #43058, `694c1be67f` #43582                                                                                     |
| Telemetry, tracing, relay                                                 | 7       | `f0769f330d` #43099, `6c1e423d0e` #43209, `44a09c99f3` #43520, `77cd243e6b` #43256, `f8b2fcbee5` #43040, `f437d6c30c` #43465                                           |
| Docs                                                                      | 1 large | `a03c43363b` #43206 (copy pass over `docs/user/`, new guides)                                                                                                          |

No kanban/board code appeared (`kanban` only in fixtures and the GitHub GraphQL schema on both sides).

## Worth incorporating

All of these arrive with a normal merge; none needs a separate port.

- **Workflow run subject** (`8987ba39d4` #42517, migration 119): runs declare a PR/issue subject and
  can be found by it; web and mobile "About" panes. Feeds AGT-05 / AUT-05.
- **Permission hardening**: push-hook approval for agents below Full access (`c4d0e05d96` #42535,
  new `apps/server/src/mcp/McpClientInput.ts`); only a full-access MCP caller can pick a child's mode
  (`9fe3150799` #39489, `apps/server/src/mcp/delegatedTaskModes.ts`); Claude Auto asks about tools
  (`923fe897d6` #43035); ACP Auto-accept edits limited to the thread's folders (`4f04b70bf8` #43046). INF-05, CMD-05.
- **Privacy / sandboxing**: theme CSS `var()` can no longer load remote files (`5e9b58e809` #39408,
  an outbound-request fix CMD-01 wants); HTML previews read only their own folder (`bed9141ec2`);
  per-type asset sandbox (`82f22ef115`); preview guests use the app preload (`972bae6a61`); saved
  secrets bound to their address (`153671166c` #43043); `az` args passed as values (`b5c725b27d`).
- **Upstream now agrees with fork deletions**: Antigravity usage probing via Google internal APIs
  removed (`96423cb5e2` #43026, deletes `antigravityUsageLimits.ts`, `v1internal` gone from
  upstream/main); Antigravity always identifies as T3 Code (`5e37e6db56` #43087). Fork patches here
  become merge noise only.
- **Agent orchestration fixes**: parent woken when a child resumes after Stop (`01848baf6c` #43459),
  finished subagents settle independently (`36816d26be` #43558), auto sends steer past a queue
  (`5fda4f7bff` #43357), prompts dropped by an early Stop recovered for Codex and OpenCode
  (`1d015a3794` #43305, `cc61cdb1e4` #43359). AGT-04, CHT-05.
- **Scheduling**: scheduled runs no longer un-snooze threads (`4fd24866ab`), daily schedules keep
  next run (`b996cf2067`), DST-safe mobile fixed-time tasks (`b99dab9495`). AUT-01.
- **Usage**: OpenCode 2 remote limits (`5519a98a8e` #43368), WSL warnings counted once
  (`049e83f234`), Antigravity pricing/instance fixes (`0d2b8eda98`, `25f47db09e`). INF-10.
- **Runtime/mode limits** (`8468c7af68` #43162): new RPC `server.getProviderRuntimeModeLimits`,
  web/mobile hide Auto where Claude settings turn it off. Mobile 2.4 already calls it
  (`apps/mobile/src/features/threads/ThreadSettingsSheet.tsx:542`, reads `.data?.limits`, so an
  older server only loses the hint — inferred).
- **Execution hosts**: agents start without `/bin/sh` (Termux, `8f0f47b1ef`), worktree containers
  refused on Git < 2.36 (`0ccd7a886e`), worktree threads track child repos checked out later
  (`a8a64ce565`), wildcard-bind port probing (`b4d93997eb`). CMD-08, CMD-17.
- **Devices / mobile**: stop devices individually (`8515b31c8d` #43191); Android inspector opens side
  chats, subagents and previews (`b972842270` #43210); the background service prints how to pair
  instead of a live token (`159bcd8e7d` #43052, also safer for CMD-22).
- **Forgejo uses `gt`** (`411e49bd3f` #42428). The fork's `0e4a0ab76e` ("prefer gt, keep tea as
  fallback") is now redundant; take upstream and drop the fork variant (6 conflicted files).
- **Performance**: command palette (`abc0c4ae55`), shared tooltip (`ea3328c50c`), sidebar rows
  (`7cfca0252c`), panel switches (`150a3c9699`), turn-item reads (`3d45d1d1ea`), mobile thread switch (`2ae731530d`).

## Must reject or strip

| ID      | Upstream change                                                                                                                                                                                                                                                                                                                                  | Action                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXC-U01 | `f0769f330d` #43099 edits `apps/server/src/telemetry/AnalyticsService.ts` (+test), `docs/internals/08_product-analytics.md`, `docs/user/telemetry.md`. Product analytics still active upstream (ingest host present in that file).                                                                                                               | Keep deleted (`git rm`). In `McpHttpServer.ts` take upstream's new `withClientInput` wrapper but drop `withToolAnalytics`.                                                                                                                                                                                                                                                                           |
| EXC-U02 | Local tracing/OTLP: `6c1e423d0e` #43209 adds a `@t3tools/shared/observability` import (`routineSpan`) to 11 server files; `44a09c99f3` #43520; `77cd243e6b` #43256 (OTLP monotonic sums, `Metrics.ts`). Also `ScheduledTaskService.ts` imports `withLocalTracing` from `@t3tools/shared/relayTracing`, and `cli/config.ts` imports OTLP helpers. | Keep the 7 modify/delete files deleted; strip the imports. **8 files merge cleanly but no longer compile** (`auth/ServerSecretStore.ts`, `milestones/MilestoneHub.ts`, `orchestration-v2/{ProjectionStore,ThreadManagementService,UsageLimitRecoveryWorker}.ts`, `workflows/{WorkflowAgentThreads,WorkflowEngine,workflow}.ts`). Neither the guard nor merge-tree reports them; only typecheck does. |
| EXC-U03 | Client trace and crash hooks: `DiagnosticsSettings.tsx` imports `TelemetryExportSettings` (deleted in fork); `client-runtime/src/state/server.ts` adds a `traceDiagnostics` atom; `apps/mobile/index.ts` still imports `observability/observe` (expo-observe crash reports through the relay).                                                   | Drop those hunks; keep upstream's `formatProcessName`/`ExpandableText` changes and the new mobile text-decoder polyfill import.                                                                                                                                                                                                                                                                      |
| EXC-U04 | Relay: `f8b2fcbee5` #43040 (`infra/relay`, turns Workers invocation logs off), `f437d6c30c` #43465 (`packages/shared/src/relayClient.ts`).                                                                                                                                                                                                       | Harmless: the fork keeps Connect/relay code unreachable for merge hygiene. Take as-is.                                                                                                                                                                                                                                                                                                               |
| EXC-U05 | Open PR #42625 "product usage data toggle", **default on**.                                                                                                                                                                                                                                                                                      | Reject if merged; `docs/user/telemetry.md` stays fork text.                                                                                                                                                                                                                                                                                                                                          |
| EXC-U06 | Open PRs #34302 (self-hosted T3 Connect relay with OIDC), #35309 (separate background delivery relay).                                                                                                                                                                                                                                           | Not T3-hosted, so not automatically excluded; evaluate #34302 for mobile push (see Open questions).                                                                                                                                                                                                                                                                                                  |
| T3-U13  | Open PR #17586 "background services update themselves" (fetches its channel's newest release).                                                                                                                                                                                                                                                   | Strip or repoint to the fork feed (`APP_RELEASE_OWNER/REPO`) if merged; the guard checks only `build-desktop-artifact.ts`.                                                                                                                                                                                                                                                                           |

Also keep deleted: `.github/workflows/release-desktop.yml` (fork replaced release CI), `apps/server/src/cli/trace.ts` (+test). Accept upstream's deletion of `apps/mobile/scripts/measure-renders.mts` (moved to `scripts/metrics/` by `e057f7a770`).

## Open + recent PRs relevant to the wishlist

From `gh pr list -R pingdotgg/t3code` (60 open, 60 merged; 58 of the 60 merged are already in `upstream/main`) plus keyword searches. "Wait" means CMDeck should not build its own version yet.

| Wishlist                           | PR                                                                                                                                                                   | State (2026-11-26)                   | Advice                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| CMD-09 per-thread Docker sandboxes | #15350 (+3,586, 60 files)                                                                                                                                            | open, CONFLICTING, last update 11-05 | Stalled. Port it or own a fork extension; don't wait indefinitely.                             |
| TLS-02 Computer use                | #16530 settings on any host, #16529 Cua Driver calls                                                                                                                 | open, #16530 MERGEABLE               | Wait.                                                                                          |
| AUT-07 quota recovery              | #43605 fallback model chains for scheduled tasks                                                                                                                     | open, CONFLICTING, active            | Wait; upstream already has `UsageLimitRecoveryWorker`.                                         |
| INF-10 usage limits                | #39893 stop turns past threshold, #29931 usage by project, #42848 periods, #31451 all-time, #33847 per-provider usage                                                | open                                 | Wait.                                                                                          |
| CMD-21 imports                     | #41296 import OpenCode sessions                                                                                                                                      | open, CONFLICTING                    | Wait; reuse for the importer framework.                                                        |
| INF-01 / CMD-12 remote             | #41771 move threads between environments (draft), #43338 link machines over numeric Tailscale address (CMD-03), #43487 change MCP client access without reconnecting | open                                 | Wait. #43338 is small and directly useful.                                                     |
| AGT-04 subagents                   | #28859 delegate tasks to another local project                                                                                                                       | open, CONFLICTING                    | Wait.                                                                                          |
| TLS-03/04 extensibility            | #34534 host extensions SDK across clients (+13,456, 167 files)                                                                                                       | open, MERGEABLE, active              | Watch closely: possible home for CMDeck extensions (Strategy §4).                              |
| CHT-05/06                          | #43754 mobile reply to responses + edit sent messages                                                                                                                | draft                                | Wait.                                                                                          |
| CHT (new)                          | #43623 thread map of turns/agents/messages                                                                                                                           | open, MERGEABLE                      | T3-U05.                                                                                        |
| INF-03 snapshots                   | #21808→#21809→#21810 checkpoint discovery/restore via MCP                                                                                                            | open, stale since 10-19              | Low odds.                                                                                      |
| DEV-01 review                      | #35324 Git/PR review actions (+37k), #34063 Codex `/review`                                                                                                          | open, CONFLICTING                    | Wait; #35324 is huge.                                                                          |
| DEV-06 / ops                       | #36693 whole-machine CPU/mem/disk/GPU monitoring, #27253 host memory pressure                                                                                        | open                                 | Wait.                                                                                          |
| AUT-01                             | #31423 `limits.scheduledTasks` policy, #42970 reorder scheduled tasks                                                                                                | open                                 | Wait.                                                                                          |
| CMD-01                             | #43728 stop injecting fake `SSH_CONNECTION` into Antigravity 1.5.17+                                                                                                 | open, MERGEABLE                      | Matches the guard's `forbidden_in` rule; once merged that rule only guards upstream behaviour. |

Merged inside the window: #42517 (workflow subject), #42535 (push hooks), #39489 (MCP mode), #43162 (mode limits), #43191 (devices), #43210 (Android inspector), #43360 (copy paths), #42428 (Forgejo gt).

## Predicted conflicts

`git merge-tree --write-tree HEAD upstream/main` reports **119 conflicted paths** (108 content, 11
modify/delete). Against `v0.1.13` it is 114 (43 outside docs/i18n). The count is driven by fork
surfaces, not commit count. Classified per `docs/operations/fork-upstream-sync.md`:

| Class (doc rule)                                                    | Files                                                                                                                                                                                                                                                                                                                                                                                                                              | Resolution                                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telemetry / tracing (keep deleted)**, modify/delete               | `apps/server/src/telemetry/AnalyticsService{,.test}.ts`, `apps/server/src/observability/{Metrics,Observability,RpcInstrumentation}.ts`, `packages/shared/src/observability{,.test}.ts`, `apps/server/src/cli/trace{,.test}.ts`                                                                                                                                                                                                     | `git rm`.                                                                                                                                   |
| Telemetry call sites, content                                       | `apps/server/src/mcp/McpHttpServer.ts` (2), `mcp/McpSessionRegistry.ts` (3; also collides with the fork's `inference` credential kind), `scheduledTasks/ScheduledTaskService.ts`, `cli/config.ts`, `cli/server.ts` (rename + trace), `server.ts` (fork `ServerActivation.forkParked`/`RemoteMcpTokens`/`PublicAddressCheck` vs upstream layer reflow), `web/.../DiagnosticsSettings.tsx` (4), `client-runtime/src/state/server.ts` | Take upstream minus tracing/analytics; keep fork layers. Plus the 8 clean-but-broken files under EXC-U02.                                   |
| **Rename (reapply CMDeck)**, docs                                   | 47 `docs/user/*.md` (mostly `a03c43363b` copy pass), `docs/README.md`, `docs/internals/04_environment-auth.md`, `docs/internals/08_product-analytics.md`, `docs/operations/04_observability.md`                                                                                                                                                                                                                                    | Take upstream, re-rename, re-apply fork-only paragraphs (install mirror, telemetry).                                                        |
| Rename, i18n                                                        | 20 files: `apps/{web,mobile}/src/i18n/translations/{de,en,es,fr,ja,ko,pt-BR,ru,sv,zh}.json`                                                                                                                                                                                                                                                                                                                                        | Take upstream, `vp run i18n:generate`, replace product name per locale.                                                                     |
| Rename, code strings                                                | `apps/mobile/modules/t3-composer-editor/.../T3ComposerEditorModule.kt` (clipboard label), `apps/server/src/cli/server.ts` (help text)                                                                                                                                                                                                                                                                                              | Upstream line + rename.                                                                                                                     |
| Telemetry (mobile)                                                  | `apps/mobile/index.ts`: upstream adds a polyfill import next to `import "./src/features/observability/observe"` (expo-observe crash reporter, deleted in fork)                                                                                                                                                                                                                                                                     | Keep the polyfill, drop `observe`.                                                                                                          |
| Shared-tooltip refactor (`ea3328c50c` #42671) vs fork tooltip edits | `apps/web/src/components/{EnvironmentContextChip,ThreadStatusIndicators}.tsx` (fork `InferenceWaitStatus`), `chat/TriageDraftHero.tsx`, `settings/AboutVersionTitle.tsx` (fork PR #18), `settings/AuthorizedClientsSettings.tsx` (fork QR pairing-URL row)                                                                                                                                                                         | Adopt `SharedTooltipTrigger`, keep fork content. No conflict in `packages/contracts/src/settings.ts`, so the **settings defaults** survive. |
| Fork features vs upstream refactors                                 | `apps/web/src/components/Sidebar.tsx` (DnD list vs upstream `SortableContext` reflow), `routes/_chat.settings.tsx` (fork `/settings/inference` route), `client-runtime/src/issueLinks.ts` (fork Vikunja `/tasks/` link vs upstream `LINEAR_LINK_HINT_PATTERN`), `scripts/smoke-desktop-app.ts` (fork CI launch vs #43694 inspector-fuse check)                                                                                     | Merge both by hand.                                                                                                                         |
| Versions                                                            | `apps/{desktop,server,web}/package.json`, `packages/contracts/package.json` (`3.0.0` vs `0.1.13`)                                                                                                                                                                                                                                                                                                                                  | Keep ours.                                                                                                                                  |
| Fork features vs upstream additions                                 | `packages/contracts/src/rpc.ts` (fork `serverRefreshInferenceServers`… vs upstream `serverGetProviderRuntimeModeLimits`), `apps/server/src/terminal/Manager.ts` (PATH merge vs managed-binary dirs), `apps/server/src/usage/cliproxyApi.test.ts`                                                                                                                                                                                   | Keep both sides.                                                                                                                            |
| Antigravity (fork hook vs upstream convergence)                     | `provider/acp/AntigravityAcpSupport{,.test}.ts`, `Drivers/AntigravityDriver.test.ts`, `provider/agentContextBudget.json`                                                                                                                                                                                                                                                                                                           | Take upstream, then update or remove the guard's two `ANTIGRAVITY_CLIENT_INFO` entries; upstream now inlines the same `{name:"t3-code"}`.   |
| Forgejo (fork feature made redundant)                               | `packages/source-control-forgejo/src/server/{ForgejoCli (15 hunks),ForgejoPullRequestProvider,ForgejoSourceControlProvider{,.test}}.ts`, `src/shared/definition.ts`, `packages/client-runtime/src/contractLabels.ts` (2)                                                                                                                                                                                                           | Take upstream (#42428) and drop the fork's `tea` fallback.                                                                                  |
| CI                                                                  | `.github/workflows/release-desktop.yml` (deleted in fork, modified upstream)                                                                                                                                                                                                                                                                                                                                                       | Keep deleted.                                                                                                                               |
| Tests/markdown                                                      | `packages/shared/src/markdownPipeline.test.ts`                                                                                                                                                                                                                                                                                                                                                                                     | Merge both.                                                                                                                                 |

**Migrations / protocol**: no conflict. `Migrations.ts` auto-merges and keeps the fork's `ensureForkSchema()` hook at the merged line 391.

**Merge-burden estimate for this sync:** about 75 mechanical files (docs, i18n, versions, kept deletions), about 30 careful code files, 8 hidden compile breaks, then guard and typecheck. Effort **M** (about a day, agent plus review).

## Protocol & migrations

- `ORCHESTRATION_PROTOCOL_VERSION = 2` at base, HEAD and upstream/main
  (`packages/contracts/src/environment.ts:13`). Last changed by `2c16c1d264` (#11974, 2026-09-15).
  No action needed.
- **New migration**: `119_WorkflowRunSubject.ts` (`8987ba39d4`): adds `workflow_runs.subject_kind/key/url/json`
  plus two partial indexes. Not identity-bound. Upstream has added roughly 1–7 migrations a day
  recently (ids 101–118 on 11-19…11-25).
- **T3Import** (`apps/server/src/fork/T3Import.ts`): nothing new to exclude. No new tables or secret
  names in the upstream diff (searched for `CREATE TABLE`, `-signing-key`, `peer-link-`, secret-store
  writes). New `stateDir/push-hooks/` (`apps/server/src/vcs/GitVcsDriverCore.ts:1289`, transient hook
  launchers) and `stateDir/providers/antigravity` profile dirs are covered: the first falls to
  `UNKNOWN` (skip), the second is under `providers` (copy, as intended). `153671166c` changes
  secret validity (bound to address), not names.
- Because CMDeck stays at migration 118, `cmdeck import-from-t3` refuses a database from official
  **v0.1.13+** until this sync lands. The import doc already says so.
- **Guard gap**: `docs/operations/fork-upstream-sync.md` says "always take upstream's
  `Migrations.ts` … exactly", but the fork hook lives in that file
  (`apps/server/src/persistence/Migrations.ts:3,389`, `ensureForkSchema`). `scripts/fork/guard.sh`'s
  `required` list does not check it. A literal "take theirs" would silently stop creating
  `inference_requests` and `auth_pairing_requests`. Add `apps/server/src/persistence/Migrations.ts:ensureForkSchema\(\)`
  to `required` and reword the doc.

## Mobile pairing

What the official mobile app (upstream `apps/mobile`, 2.4.0) needs from a server, all of which CMDeck keeps:

1. **Descriptor**: `GET /.well-known/t3/environment` (`packages/contracts/src/environmentHttp.ts:591`),
   fetched by `packages/client-runtime/src/environment/descriptor.ts:13`. The client compares
   `orchestrationProtocolVersion` (served from `apps/server/src/environment/ServerEnvironment.ts:220`)
   in `packages/client-runtime/src/connection/compatibility.ts:18-22` and blocks a mismatch
   (`#11974`). This is why the guard pins the version.
2. **Auth**: `POST /oauth/token` with optional DPoP (`environmentHttp.ts:612`), then
   `/api/auth/websocket-ticket` (`:620`) and the `/ws` RPC with the protocol header
   (`client-runtime/src/state/environmentHttpAuth.ts:35-39`).
3. **Pairing URL**: the server prints `http(s)://<host>:<port>/pair#token=<code>`
   (`apps/server/src/startupAccess.ts:222-227`) and a `t3code://pair?pairingUrl=…` app link
   (`packages/shared/src/remote.ts:213`), with a terminal QR code. The mobile app accepts a QR code
   (`apps/mobile/src/features/connection/pairing.ts:78`, raw URL or `t3code:` link) or a typed
   host and code (`buildPairingUrl`, `pairing.ts:33`; IP literals default to `http`). Deep-link
   prefill is dev-only in store builds (`devAutoConnect.ts:91` `pairingLinksAllowed`), so pair by QR
   or by typing. **None of this touches T3 Connect**: LAN or Tailscale pairing works directly.
4. **CMDeck device approval**: with `requireConnectDeviceApproval` (fork default true,
   `packages/contracts/src/settings.ts`, guarded) direct pairing returns
   `connect_approval_pending` (`apps/server/src/auth/http.ts:313-327`). That error code is
   upstream's own (`packages/contracts/src/environmentHttp.ts:222`, handled by
   `client-runtime/src/connection/diagnosis.ts:111,182`), so the official app shows "waiting for
   approval" and retries. Compatible.
5. **Not available without Connect**: push notifications and Live Activities register with the
   T3 relay (`apps/mobile/src/features/agent-awareness/remoteRegistration.ts:173-175`,
   `resolveCloudPublicConfig().relay.url`). The relay URL is built into the official app, so CMDeck
   cannot offer background push to it (cmdeck-fork.csv notes the same for CMD-02).
6. Newer mobile builds call newer RPCs (e.g. `server.getProviderRuntimeModeLimits`, #43162). They
   tolerate their absence (inferred from `.data?.limits`). Frequent syncs keep the app and server close.

## Strategy

**1. Cadence: sync at every upstream stable tag (every 2–5 days), at least weekly.** Upstream lands
about 320 commits a day, but the conflict set is set mostly by fixed fork surfaces (rename,
telemetry deletions, a few feature files): 114 conflicts at `v0.1.13` against 119 at main tip.
Pause syncs only for an upstream protocol bump; then sync promptly, because the mobile app follows
upstream. Tags are tested points and nightly-tag commits match the stable tag here. Keep using
`scripts/fork/sync-upstream.sh <tag>`.

**2. Make the script and guard catch what this window shows** (effort S each):

- Run `vp run typecheck` (at least `apps/server`) after the merge in `sync-upstream.sh`. The 8
  clean-but-broken files are invisible to the guard.
- Add the `ensureForkSchema` required entry and fix the doc wording (see Protocol & migrations).
- Auto-resolve the mechanical classes: `git checkout --ours` the four `package.json` version
  lines, and `git rm` the known deleted telemetry paths when they conflict. A rebrand helper (take
  theirs for `docs/user/**` and the i18n JSON, re-run the rename, then `vp run i18n:generate`)
  covers about 71 of 119 files.
- Replace the two `ANTIGRAVITY_CLIENT_INFO` guard entries with a check that accepts upstream's
  inline `name: "t3-code"`.

**3. Shrink the telemetry fan-out** (effort M; the biggest recurring cost). 64 upstream files import
`AnalyticsService`, `@t3tools/shared/observability`, `relayTracing` or `otelEnvironment` (36 for
`observability` alone). Every upstream tracing tweak (like #43209) breaks fork compiles. Options:

- (a) Keep upstream's **local-only** tracing modules (spans and trace files never leave the
  machine) and delete only exporters (OTLP, `otelEnvironment`, `AnalyticsService`). The guard
  keeps forbidding `@opentelemetry/exporter`, `OTLPTraceExporter`, ingest hosts, PostHog.
- (b) Keep deletions but add a tiny inert `packages/shared/src/observability.ts` exporting the
  symbols call sites use (`routineSpan` and friends).

(a) has the lowest burden and still meets "no telemetry". (b) keeps the fork's current "deleted"
stance. This needs the user's decision (Open questions).

**4. Isolate CMDeck extensions:**

| Surface                                          | Today                                                                         | Proposal                                                                                                                                             | Burden now → after |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Fork tables                                      | `ForkSchema.ts` + one hook line                                               | Keep; guard the hook                                                                                                                                 | Low → Low          |
| Fork services in `server.ts`                     | inline layers in upstream's pipe (conflicted this time)                       | one `apps/server/src/fork/ForkLayer.ts`, merged with a single `provideMerge` line                                                                    | M → S              |
| Fork RPCs (`serverRefreshInferenceServers` …)    | entries in `packages/contracts/src/rpc.ts` `WS_METHODS`                       | separate `forkRpc.ts` group spread in one line                                                                                                       | M → S              |
| `McpSessionRegistry` `inference` credential kind | edits inside upstream's resolve                                               | wrap in a fork module or upstream it                                                                                                                 | M → S              |
| Rebrand                                          | about 509 of 1,117 changed app/package files only add CMDeck identity strings | rebrand helper script now; longer term route display names through `appIdentity`/i18n variables                                                      | High → M           |
| Forgejo `tea` fallback                           | fork variant                                                                  | drop, take #42428                                                                                                                                    | M → 0              |
| Antigravity identity / `v1internal`              | fork patches                                                                  | upstream converged (#43087, #43026)                                                                                                                  | M → 0              |
| Future extensions                                | n/a                                                                           | if upstream #34534 (host extensions) merges, build CMDeck-only features (inference servers, Vikunja, E2EE helpers) as host extensions where possible | n/a                |

**5. Prefer upstream for the open-PR features above.** Build fork versions only where a PR is stale
and the need is concrete (CMD-09 Docker, #15350, stalled since 11-05).

## Ledger entries

Suggested additions to the `RESEARCH_LEDGER.md` Log. This agent writes only under `research/`, so it did not edit the ledger.

- 2026-11-26 [upstream] completed — upstream/main `9b4943f91c`, 324 commits past base `9ea5044aef` (302 fix / 8 feat), v0.1.13 `bc0f04da94`; merge-tree predicts 119 conflicts (51 docs, 20 i18n, 11 modify/delete telemetry) plus 8 clean-merge compile breaks from #43209 (high).
- 2026-11-26 [upstream] completed — protocol version unchanged (2); one new migration 119 (workflow run subject), not identity-bound; T3Import needs no new exclusions (high).
- 2026-11-26 [upstream] conflict — guard does not protect the `ensureForkSchema` hook in `Migrations.ts`; the sync doc says to take that file exactly (high).
- 2026-11-26 [upstream] decision needed — keep upstream local-only tracing (drop only exporters) vs inert stub, to cut the 64-file telemetry fan-out (medium).
- 2026-11-26 [upstream] completed — official mobile app pairs over LAN/Tailscale without Connect; push/Live Activities require the T3 relay (high).
- IDs assigned: T3-U01…T3-U13, EXC-U01…EXC-U06 (see `upstream-sync.csv`).

## Open questions

1. Telemetry fan-out: option (a) keep local-only upstream tracing, or (b) an inert stub? (Strategy §3)
2. Mobile push: is background push for the official app required? If so, evaluate #34302
   (self-hosted relay with OIDC) and check whether the official app can be pointed at a non-T3 relay.
   Current code reads a built-in relay URL, so probably not.
3. Should CMDeck own Docker sandboxes (CMD-09) given #15350 has stalled, or wait?
4. Keep the fork's `docs/user/` rewrites (install-from-mirror, telemetry), or keep `docs/user/`
   upstream-identical and move fork guidance to separate fork pages to cut doc conflicts?
5. Not verified: full typecheck of the merged tree (no checkout permitted). The 8 broken files were
   found by grepping imports of fork-deleted modules; other semantic breaks may exist.
