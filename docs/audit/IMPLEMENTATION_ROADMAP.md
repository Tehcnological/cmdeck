# CMDeck implementation roadmap

Brief §12.7 and §12.8. Audit date 2026-11-26, CMDeck at `4a2f27d590`. Architecture, boundaries and the
decisions marked **A1–A15** are in [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) (§16). Feature IDs
are from [RESEARCH_LEDGER.md](RESEARCH_LEDGER.md); the canonical inventory is
[FEATURE_MATRIX.csv](FEATURE_MATRIX.csv). Ideas outside the selected scope (`NEW-*`, some `KCX-*`) are in
[NEW_FEATURE_PROPOSALS.md](NEW_FEATURE_PROPOSALS.md) and are **not scheduled** here.

Only genuine remaining work is listed. Anything already implemented, inherited, or waiting on upstream
is in [Not scheduled](#not-scheduled-covered-or-waiting). Every selected ID is mapped in the
[feature index](#appendix-feature-to-work-item-index).

Paths were checked to exist at `4a2f27d590` unless marked **(new)**. "Candidate seam" means the file is
the likely hook point found by reading call sites; the implementing agent confirms it first.

## How to use this roadmap

- One work item (WI) is one worktree and one PR. Do not combine WIs unless the
  [parallelization plan](#parallelization-plan) says to.
- Start a WI only when its dependencies are merged. A WI that touches a hotspot file waits for that
  file's owner (see [hotspot ownership](#hotspot-ownership)).
- `A#` in a dependency means an approval from the user is needed first.

### Rules every WI follows

These apply to all items and are not repeated per WI.

1. **Placement.** New server code goes in `apps/server/src/fork/<module>/` as Effect services
   (`docs/internals/02_effect-services.md`). New wire types go in `packages/contracts/src/fork/` (new).
   New web code goes in `apps/web/src/fork/` (new). Upstream files get single-line hooks only, each added
   to the `required` list in `scripts/fork/guard.sh`.
2. **Tables** go in the module's own `schema.ts` with idempotent `CREATE ... IF NOT EXISTS`, called from
   `apps/server/src/persistence/ForkSchema.ts`. Never a numbered migration.
3. **RPCs** go in the fork RPC group (WI-1.01) with a scope entry in the fork guarded-scope table that
   spreads into `CLIENT_GUARDED_RPC_SCOPES` (`packages/contracts/src/clientRpcPermissions.ts`). Web uses
   `createEnvironmentRpcCommand` and gates UI with `permissionAtom`.
4. **Agent reach.** Anything a user can trigger is a service method reachable from an MCP tool and from
   scheduled tasks or workflows, not only from a UI handler.
5. **Tests** follow `docs/internals/15_testing.md`: test at the lowest failing layer, `it.effect` with
   `TestClock`, drain `OrchestrationEffectWorkerV2` or await the `Deferred` instead of sleeping, browser
   tests only for real browser behaviour with `await using screen = await render(...)`. Run
   `vp test run <files>`, `vp run typecheck` and `vp run check:changed` before pushing. No repo-wide runs.
6. **Model-facing text** (MCP tool names, descriptions, schemas, preset briefs, skills) changes require
   the evals named in `evals/README.md`, with a failing case first for behaviour bugs.
7. **Copy** is translated in `apps/web/src/i18n/translations` (`vp run i18n:generate`,
   `vp run i18n:check`).
8. **Hit every surface** (AGENTS.md): state in the PR which of web, desktop, PWA phone width, official
   mobile (usually "ordinary thread, no new UI"), each provider, and each connection mode applied.
9. **Privacy.** No new automatic outbound request. Optional modules are inert when disabled and add a
   case to the egress test (WI-0.06).
10. **Docs.** User-visible features get a short `docs/user/` page or section. `docs/internals/` only for
    cross-component decisions (the fork seams in WI-1.01 qualify).

## Phase overview

| Phase                                   | Goal                                                                                                                                 | WIs | Exit criteria                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- | ----------------------------------------------------------------------------------------------------------------- |
| **0** Sync and repair                   | Upstream `v0.1.13`, fix shipped breakage, close privacy leaks, lock them with a test                                                 | 9   | Guard + typecheck + egress test green on the synced tree; PR #23 merged; SSH bootstrap works from CMDeck releases |
| **1** Foundations                       | Fork seams, redaction, audit, notifications, scheduler core, workflow trust, memory core, importer framework, independent quick wins | 12  | Every Phase 2 dependency merged; hooks in guard                                                                   |
| **2** Features on the foundations       | Presets, bots, memory UI and learning, decision service, automation, chat items, security, sandbox                                   | 21  | Each selected AGT/MEM/AUT/CHT/TLS/INF/DEV item either shipped or explicitly deferred                              |
| **3** Integrations and optional modules | Messaging, Kiro import, snapshots, skills, heavier presets, productivity, PWA and Web Push, AWS env scoping                          | 11  | Optional modules inert when off (egress test cases)                                                               |
| **4** Conditional and low priority      | Items behind approvals or with weak demand                                                                                           | 6   | Started only after the listed approval                                                                            |

Total: 59 WIs. Approvals A1–A15 were answered on 2026-11-26 ([RESEARCH_LEDGER.md](RESEARCH_LEDGER.md#approvals-2026-11-26)); WI text below reflects them.

## Work item summary

| WI      | Title                                                     | Category                                | Effort | Depends on             |
| ------- | --------------------------------------------------------- | --------------------------------------- | ------ | ---------------------- |
| WI-0.01 | Merge PR #23, clean stale branches                        | Existing CMDeck fixes                   | S      | —                      |
| WI-0.02 | Harden fork guard and sync script                         | Upstream synchronization                | S      | —                      |
| WI-0.03 | Sync to upstream `v0.1.13`                                | Upstream synchronization                | M      | 0.01, 0.02, A1         |
| WI-0.04 | Client-side privacy fixes                                 | Existing CMDeck fixes                   | S      | A3                     |
| WI-0.05 | Server-side privacy fixes                                 | Existing CMDeck fixes                   | S      | —                      |
| WI-0.06 | Egress privacy regression tests                           | Security and recovery                   | M      | 0.03, 0.04, 0.05       |
| WI-0.07 | Fix stale user docs                                       | Existing CMDeck fixes                   | S      | 0.03                   |
| WI-0.08 | Release artifacts for SSH, headless and missing platforms | Existing CMDeck fixes                   | M      | 0.05, A11              |
| WI-0.09 | Official mobile app device check                          | PWA and mobile compatibility            | S      | 0.03                   |
| WI-1.01 | Fork extension seams                                      | Foundational infrastructure             | M      | 0.03                   |
| WI-1.02 | Shared redaction module                                   | Security and recovery                   | M      | 0.03                   |
| WI-1.03 | Hash-chained audit log                                    | Security and recovery                   | M      | 1.01, 1.02             |
| WI-1.04 | Notification delivery service                             | Foundational infrastructure             | M      | 1.01, 1.02, 1.03       |
| WI-1.05 | Scheduler: cron, failure auto-pause, quota hold           | Automation and monitoring               | M      | 0.03                   |
| WI-1.06 | Workflows: trust gate, presets, default on                | Autonomous execution                    | M      | 1.01, 1.03, A2         |
| WI-1.07 | Memory store core                                         | Memory and intelligence                 | L      | 1.01, 1.02             |
| WI-1.08 | Importer framework                                        | Foundational infrastructure             | M      | 0.03                   |
| WI-1.09 | Engine names from M3 (oMLX, Osaurus, Locals)              | M3 functionality                        | S      | 0.03                   |
| WI-1.10 | Default thread environment (M3-28)                        | M3 functionality                        | S      | 1.01                   |
| WI-1.11 | Bedrock and AWS guidance, Claude Bedrock preset           | Optional AWS                            | S      | 0.03                   |
| WI-1.12 | Open any thread beside the current one                    | Small usability                         | S      | 1.01                   |
| WI-2.01 | Spec → Task Runner preset                                 | Autonomous execution                    | M      | 1.06                   |
| WI-2.02 | Conductor thread and Work Ledger                          | Autonomous execution                    | M      | 1.01, 1.06             |
| WI-2.03 | Research Lab preset                                       | Autonomous execution                    | S      | 1.06                   |
| WI-2.04 | Bot profiles                                              | Persistent agents                       | M      | 1.07                   |
| WI-2.05 | Memory UI and memory modes                                | Memory and intelligence                 | M      | 1.07                   |
| WI-2.06 | Session state card                                        | Memory and intelligence                 | S      | 1.07                   |
| WI-2.07 | Lessons and opt-in consolidation                          | Memory and intelligence                 | M      | 1.07, 2.05, A5         |
| WI-2.08 | Optional local embeddings, decay                          | Memory and intelligence                 | M      | 1.07                   |
| WI-2.09 | Knowledge Library and Notes                               | Memory and intelligence                 | M      | 1.07                   |
| WI-2.10 | Decision service                                          | Memory and intelligence                 | M      | 1.01, A5               |
| WI-2.11 | Check-script gate                                         | Automation and monitoring               | M      | 1.05, 1.06             |
| WI-2.12 | Monitor loops, heartbeats, quiet turns                    | Automation and monitoring               | M      | 1.04, 2.11             |
| WI-2.13 | Event triggers for scheduled tasks                        | Automation and monitoring               | S      | 2.11                   |
| WI-2.14 | Usage threshold alerts                                    | Automation and monitoring               | S      | 1.04                   |
| WI-2.15 | Message pins                                              | Small usability                         | S      | 1.01                   |
| WI-2.16 | Server-side approval policy                               | Security and recovery                   | M      | 1.03                   |
| WI-2.17 | Encrypted secrets at rest                                 | Security and recovery                   | M      | 1.01, A12              |
| WI-2.18 | Container sandbox runner (Docker, Apple `container`)      | Remote execution / Security             | L      | 1.01, 1.03             |
| WI-2.19 | Windows Sandbox feasibility spike                         | Security and recovery                   | S      | —                      |
| WI-2.20 | Code Review Sage preset                                   | Developer tools                         | M      | 1.06                   |
| WI-2.21 | Design Critique skill                                     | Developer tools                         | S      | —                      |
| WI-3.01 | Messaging adapter interface + Telegram                    | Optional messaging                      | M      | 1.04                   |
| WI-3.02 | Slack (Socket Mode)                                       | Optional messaging                      | M      | 3.01                   |
| WI-3.03 | Kiro Crew importer                                        | Foundational infrastructure (migration) | L      | 1.05, 1.08, 2.04, 2.05 |
| WI-3.04 | App-state snapshot export and import                      | Security and recovery                   | M      | 1.08, 1.02             |
| WI-3.05 | Automatic skill proposals                                 | Memory and intelligence                 | M      | 2.07                   |
| WI-3.06 | Auto-Improvement preset                                   | Developer tools                         | L      | 1.06, 2.01             |
| WI-3.07 | Ops Mission Control preset                                | Developer tools                         | M      | 2.12, 2.13             |
| WI-3.08 | LaTeX compile action, PPTX skill guide                    | Optional productivity                   | M      | — (2.18 optional)      |
| WI-3.09 | PWA behind Cloudflare Access                              | PWA and mobile compatibility            | M      | 2.05, 2.15             |
| WI-3.10 | AWS credential environment scoping                        | Optional AWS                            | S      | 0.05                   |
| WI-3.11 | Web Push for the PWA (NEW-A09, approved A14)              | PWA and mobile compatibility            | M      | 1.04, 3.09             |
| WI-4.01 | Agent Channels room thread                                | Autonomous execution                    | M      | 2.02, A13              |
| WI-4.02 | Microsoft Teams adapter                                   | Optional messaging                      | M      | 3.01, A7               |
| WI-4.03 | Local engine manager (M3-09)                              | M3 functionality                        | L      | 1.01                   |
| WI-4.04 | Element picker for streamed browser tabs                  | Developer tools                         | M      | —                      |
| WI-4.05 | Honest context breakdown                                  | Small usability                         | M      | 1.07                   |
| WI-4.06 | Windows Sandbox backend                                   | Security and recovery                   | L      | 2.18, 2.19 go          |

---

## Phase 0: sync and repair

### WI-0.01 Merge PR #23 and clean stale branches

- **Category:** Existing CMDeck fixes. **Features:** CMD-02, CMD-05. **Effort:** S. **Depends on:** —
- **Objective:** ship the fix for the "Use in another app (MCP)" crash on `main` (Clerk `useAuth` outside
  `ClerkProvider`), the copy fixes and the remote MCP address list; delete the merged remote branches
  listed in [research/cmdeck-fork.md](research/cmdeck-fork.md) §4.
- **Builds on:** open PR #23 `fix/settings-copy-and-mcp-button` (`36f945487d`, `9e5d069108`).
- **Files:** as in the PR (MCP wizard entry points, guest-link entry points, settings copy).
- **Source:** existing PR.
- **Acceptance:** on a build with no cloud config, every MCP entry point opens the direct MCP path without
  a crash; guest links stay hidden; the branch list in §4 is gone from `origin`.
- **Tests:** the PR's tests; if none cover the crash, add one case rendering the entry point without a
  `ClerkProvider` (regression proof per `15_testing.md`).
- **Security / privacy:** none new. **Mobile:** none. **Upstream:** touches Connect-adjacent UI kept for
  merge hygiene; low risk.
- **Conflicts:** merge before WI-0.03.

### WI-0.02 Harden the fork guard and sync script

- **Category:** Upstream synchronization. **Features:** CMD-18, CMD-01. **Effort:** S. **Depends on:** —
- **Objective:** make the sync catch the failures the 11-25 window would have hidden
  ([UPSTREAM_SYNC.md](UPSTREAM_SYNC.md) "Guard gap", Strategy §2).
- **Builds on:** `scripts/fork/guard.sh` (`required` array), `scripts/fork/sync-upstream.sh`,
  `docs/operations/fork-upstream-sync.md`.
- **Changes:** add `apps/server/src/persistence/Migrations.ts:ensureForkSchema\(\)` to `required`; reword
  the doc's "take upstream's `Migrations.ts` exactly"; run `vp run typecheck` after the merge in
  `sync-upstream.sh` and fail on errors; auto-resolve mechanical classes (`--ours` for the four
  `package.json` versions, `git rm` for known deleted telemetry paths, take-theirs plus the rename helper
  and `vp run i18n:generate` for `docs/user/**` and translation JSON). After WI-0.03, replace the two
  `ANTIGRAVITY_CLIENT_INFO` entries with a check that accepts upstream's inline `name: "t3-code"`.
- **Acceptance:** removing the `ensureForkSchema()` line fails the guard; a scratch merge of `v0.1.13`
  (in a sibling worktree, never the live checkout) stops at the typecheck step and lists the 8
  clean-merge compile breaks named in UPSTREAM_SYNC.md EXC-U02.
- **Tests:** shell scripts; attach the mutation transcript to the PR. Fork CI already runs the guard.
- **Security / privacy:** keeps the forbidden-pattern and release-feed rules intact.
- **Mobile:** guard check 1 (protocol version) unchanged. **Upstream:** reduces each sync's manual set
  from ~119 to ~45 files.
- **Conflicts:** `guard.sh` is appended to by most later WIs; this one goes first.

### WI-0.03 Sync to upstream `v0.1.13`

- **Category:** Upstream synchronization. **Features:** CMD-18, CMD-17, CMD-01, CMD-22, plus the upstream
  items in [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md) "Worth incorporating" (T3-U01..U03, T3-U07..U12; T3-U04..U06 are
  still open upstream PRs and wait, T3-U13 is excluded). **Effort:** M.
- **Depends on:** WI-0.01, WI-0.02, decision **A1** (telemetry fan-out).
- **Objective:** merge `v0.1.13` (`bc0f04da94`) with `scripts/fork/sync-upstream.sh v0.1.13`.
- **Specifics:** resolve the 114 predicted conflicts by class; take upstream Forgejo `gt` (#42428) and drop
  the fork `tea` fallback; take upstream's Antigravity convergence (#43026, #43087); handle EXC-U01..U05
  (keep analytics deleted; under A1(a) take upstream's local-only tracing modules minus exporters, under
  A1(b) strip the imports from the 8 compile-broken files); take migration 119; re-apply the rename; keep
  versions at 3.x.
- **Acceptance:** guard passes; `vp run typecheck` passes; fork CI green; `ORCHESTRATION_PROTOCOL_VERSION`
  still 2; a copy of a `statev2.sqlite` (never the live `~/.t3/userdata` or `~/.cmdeck/userdata`) migrates
  through 119 with `inference_requests` and `auth_pairing_requests` present;
  `cmdeck import-from-t3 --plan` accepts a v0.1.13 database.
- **Tests:** fork CI; `vp test run apps/server/src/fork/T3Import.test.ts apps/server/src/fork/ForkAlerts.test.ts`.
- **Security:** brings upstream fixes #42535 (push-hook approval), #39489 (MCP mode selection), #43043
  (secrets bound to address), #39408 (no remote theme CSS loads), #43046, #43035.
- **Privacy:** grep the merged diff for new hosts; reject EXC-U05 if it has landed.
- **Mobile:** keeps parity with official app 2.4 (`server.getProviderRuntimeModeLimits`).
- **Upstream:** this is the cadence baseline: repeat at every stable tag, at least weekly.
- **Conflicts:** touches everything. Other WIs rebase after it lands.

### WI-0.04 Client-side privacy fixes

- **Category:** Existing CMDeck fixes. **Features:** CMD-01. **Effort:** S. **Depends on:** A3.
- **Objective:** stop automatic third-party requests from the renderer and the desktop shell.
- **Changes:**
  1. `packages/shared/src/favicon.ts` (`faviconUrlForOrigin`) stops building
     `www.google.com/s2/favicons` URLs. Site icons are off by default and show a local fallback; an opt-in
     client setting loads `<origin>/favicon.ico` directly. Callers:
     `apps/web/src/components/chat/MarkdownExternalLink.tsx`, `apps/web/src/components/RightPanelTabs.tsx`,
     `apps/web/src/components/chat/TimelineToolActivityIcon.tsx`.
  2. A Settings toggle for desktop update checks over `apps/desktop/src/settings/DesktopAppSettings.ts` and
     the pollers in `apps/desktop/src/updates/DesktopUpdates.ts` (`startUpdatePollers`). Default unchanged
     (check only); `T3CODE_DISABLE_AUTO_UPDATE` and managed policy still win.
  3. Linux spellcheck dictionary downloads **(inferred from Electron defaults)**: confirm, then disable the
     remote dictionary URL in the desktop session setup.
- **Acceptance:** with defaults, a chat with external links and a preview tab produces no request to
  `google.com` (asserted by WI-0.06); with site icons on, only `<origin>/favicon.ico` is requested; turning
  update checks off stops the pollers without a restart.
- **Tests:** extend `packages/shared/src/favicon.test.ts` (no Google host, null when off); one case in
  `apps/desktop/src/updates/DesktopUpdates.test.ts` for the setting.
- **Security:** none. **Privacy:** removes a per-link hostname leak to Google.
- **Mobile:** no mobile importer of `favicon.ts`. **Upstream:** small edit to an upstream shared file;
  propose the option upstream; add a guard forbidden pattern for `google.com/s2/favicons`.
- **Conflicts:** `packages/contracts/src/settings.ts` with WI-0.05 (both add one setting; land 0.05 first or
  rebase).

### WI-0.05 Server-side privacy fixes

- **Category:** Existing CMDeck fixes. **Features:** CMD-01, CMD-11. **Effort:** S. **Depends on:** —
- **Changes:**
  1. A provider setting to stop the Claude subscription-usage poll
     (`apps/server/src/provider/claudeResetCredits.ts:216`, `api.anthropic.com/api/oauth/usage`). Default
     on; it talks only to the configured provider, but the user can now turn it off.
  2. Add `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` to the telemetry opt-out set, and apply the opt-out
     set even when a `baseEnv` is passed (`packages/provider-core/src/server/instanceEnvironment.ts`
     `mergeProviderInstanceEnvironment`, line 22). The user's own environment still overrides.
  3. A switch for the LiteLLM price download (`apps/server/src/usage/UsageService.ts:72-75`); off means
     bundled and custom prices only.
  4. Retarget `t3 update` to CMDeck releases (`packages/shared/src/cliRelease.ts:6,156`) and stop
     `t3 triage` from telling agents to fetch upstream's playbook
     (`apps/server/src/triage/triagePrompt.ts:37`).
- **Acceptance:** with the Claude switch off, no `/api/oauth/usage` request; spawned Claude envs carry the
  flag with and without `baseEnv`; Usage with the price switch off makes no LiteLLM request; `cmdeck update`
  lists `Tehcnological/cmdeck` releases; no `pingdotgg/t3code` URL in either file (guard rule).
- **Tests:** add the `baseEnv` row to the instance-environment test; one case each in the
  `claudeResetCredits` and `UsageService` tests; triage prompt text is model-facing, so run the triage eval
  if one exists (`evals/README.md`).
- **Security:** the triage change removes upstream-controlled text that steered agents.
- **Privacy:** closes three automatic paths. **Mobile:** none. **Upstream:** small edits; guard entries.
- **Conflicts:** `settings.ts` (WI-0.04); `instanceEnvironment.ts` (WI-3.10 later); `cliRelease.ts`
  (WI-0.08 after this).

### WI-0.06 Egress privacy regression tests

- **Category:** Security and recovery. **Features:** CMD-01, brief §10 "privacy regression tests".
  **Effort:** M. **Depends on:** WI-0.03, WI-0.04, WI-0.05.
- **Objective:** fail CI when a default install makes an unexpected outbound request or a disabled module
  starts work.
- **Changes:** a server test **(new)** `apps/server/src/fork/privacy/egress.test.ts` that builds the server
  layer with default settings, a recording `HttpClient` layer and a `globalThis.fetch` trap, advances
  `TestClock` past every periodic check (provider checks, usage, git fetch with no projects), and asserts
  zero requests and no fork-module fibres. A guard rule listing forbidden hosts in runtime code (Google s2,
  analytics ingest hosts, `pingdotgg/t3code` in runtime paths). Each later optional module adds a
  "disabled means inert" row here.
- **Acceptance:** reverting WI-0.04 or WI-0.05 makes the test fail; on the synced tree it passes.
- **Tests:** this WI is the test. **Security / privacy:** primary purpose.
- **Mobile:** none. **Upstream:** fork-only test file; no upstream hook.
- **Conflicts:** none; later WIs append rows.

### WI-0.07 Fix stale user docs

- **Category:** Existing CMDeck fixes. **Features:** AUT-06, CMD-02, CMD-22, CMD-01. **Effort:** S.
  **Depends on:** WI-0.03 (the sync rewrites `docs/user/`).
- **Files:** `docs/user/project-settings.md` (webhook automations still describe a T3 Connect tunnel and
  "Hold webhooks while offline"), `docs/user/mobile-notifications.md` (push via the relay),
  `docs/user/telemetry.md`, `docs/user/cloudflare-tunnel.md` (Access bypass for `/api/hooks` only).
- **Acceptance:** no page promises Connect tunnels, held webhooks or push to the official app; webhook
  docs point to Cloudflare Tunnel with an Access bypass for the hooks path.
- **Tests:** none (docs). **Upstream:** doc conflicts at each sync; keep fork paragraphs short.
- **Conflicts:** none.

### WI-0.08 Release artifacts for SSH, headless and missing platforms

- **Category:** Existing CMDeck fixes / Remote execution. **Features:** CMD-08, CMD-12. **Effort:** M.
- **Depends on:** WI-0.05 (`cliRelease.ts`), **A11**.
- **Objective:** SSH-managed environments and headless installs work without a self-hosted mirror; close
  the platform gaps.
- **Builds on:** `.github/workflows/fork-release.yml`, `fork-desktop-build.yml`, `fork-ci.yml`;
  `packages/shared/src/cliRelease.ts` (`CLI_RELEASE_DEFAULT_BASE_URL` is a `.invalid` placeholder);
  `packages/ssh/src/tunnel.ts:497-558` (downloads from `T3CODE_RELEASE_BASE_URL`).
- **Changes:** build and attach the CLI/server archives the bootstrap expects, with a checksum file; point
  the default base URL at CMDeck releases through `packages/shared/src/appIdentity.ts`; make the release
  job fail when an archive is missing; add macOS x64 and Linux arm64 desktop builds if runners allow; add a
  Windows test job. Verify the bootstrap checks archive integrity and add a SHA-256 check if it does not
  **(not verified)**.
- **Acceptance:** Add project → SSH machine on a clean Linux host bootstraps CMDeck from the release with no
  `T3CODE_RELEASE_BASE_URL`; `cmdeck update` downloads; the guard rejects a non-CMDeck base URL.
- **Tests:** release dry run in CI; one URL-composition case in the `packages/ssh` tests.
- **Security:** HTTPS from GitHub plus checksum. **Privacy:** GitHub contacted only on user-initiated
  bootstrap or update. **Mobile:** none. **Upstream:** fork workflows only.
- **Conflicts:** `cliRelease.ts` (after WI-0.05).

### WI-0.09 Official mobile app device check

- **Category:** PWA and mobile compatibility. **Features:** CMD-22. **Effort:** S. **Depends on:** WI-0.03.
- **Objective:** settle whether the current store app works against CMDeck (`ba004a8f06` vs `8b51f2a348`
  disagree on pending-approval retry).
- **Acceptance:** a short result table in the mobile user doc: app version, pairing over LAN and Tailscale
  with device approval, thread list, steer, approve, stop, scheduled task list, known limits (no push, no
  Cloudflare Access).
- **Tests:** device run by the primary agent with the device tools; existing
  `packages/client-runtime/src/connection/onboarding.test.ts`.
- **Conflicts:** none.

---

## Phase 1: foundations and independent quick wins

### WI-1.01 Fork extension seams

- **Category:** Foundational infrastructure. **Features:** enables all fork features; CMD-18 (merge burden).
  **Effort:** M. **Depends on:** WI-0.03.
- **Objective:** give every later WI a place to add RPCs, settings, MCP tools, tables, panels and commands
  without editing upstream hotspots again ([ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §13).
- **New files:** `apps/server/src/fork/ForkLayer.ts`, `apps/server/src/fork/rpc/ForkRpcHandlers.ts`,
  `apps/server/src/fork/mcpToolkits.ts`, `packages/contracts/src/fork/rpc.ts` (`ForkWsRpcGroup`, fork method
  names, fork guarded scopes), `packages/contracts/src/fork/settings.ts` (`CmdeckSettings`),
  `apps/web/src/fork/panels.ts`, `apps/web/src/fork/commands.ts`, one `docs/internals/` paragraph on the
  seams.
- **One-line hooks:** `apps/server/src/server.ts` (provide `ForkLayer`; move existing fork layers such as
  `ForkAlerts`, `RemoteMcpTokens`, `PublicAddressCheck` into it), `packages/contracts/src/rpc.ts` (merge
  `ForkWsRpcGroup` into `WsRpcGroup`), `apps/server/src/ws.ts` (merge fork handlers),
  `packages/contracts/src/clientRpcPermissions.ts` (spread fork scopes), `apps/server/src/mcp/McpHttpServer.ts`
  (register fork toolkits), `packages/contracts/src/settings.ts` (optional `cmdeck` key),
  `apps/web/src/rightPanelStore.ts` (one `cmdeck` surface kind), `apps/web/src/components/CommandPalette.tsx`
  (fork command source). Each goes in the guard.
- **Acceptance:** a first fork RPC is callable from web and refused for a client without the scope; settings
  without a `cmdeck` key decode to defaults; removing any hook fails the guard; the official app still
  connects (protocol 2) and decodes settings.
- **Tests:** one authorization case for a fork method in the existing RPC authorization tests; a
  `packages/contracts/src/settings.test.ts` row for absent/present `cmdeck`; guard.
- **Security:** fork methods go through the same group middleware (`auth/RpcAuthorization.ts`).
- **Mobile:** additive only. **Upstream:** every hotspot drops to one fork line.
- **Conflicts:** touches every hotspot once; land alone, then everything else rebases.
- **As built:** the right-panel `cmdeck` surface kind and `apps/web/src/fork/panels.ts` were left out
  because nothing in Phase 1 opens a fork panel; the first WI that needs one adds them. Existing fork
  layers other than `RemoteMcpTokens` and `PublicAddressCheck` stay put (`ForkAlerts` feeds
  `ServerSettings`). Seams are listed in `docs/operations/fork-upstream-sync.md`.

### WI-1.02 Shared redaction module

- **Category:** Security and recovery. **Features:** INF-07. **Effort:** M. **Depends on:** WI-0.03.
- **Objective:** one redactor applied on by default to logs, exports and outbound messages.
- **New:** `packages/shared/src/redaction.ts` (subpath export in `packages/shared/package.json`; no barrel)
  with high-signal vendor formats (GitHub, Slack, AWS access keys with labelled secrets, Anthropic, OpenAI,
  JWTs, private-key blocks, bearer headers, URL credentials), labelled values, and a streaming hold-back
  helper. No entropy guessing.
- **Wire into:** `apps/server/src/serverLogger.ts` (beside `Redactable`), `apps/server/src/feedback/scrubFeedback.ts`,
  `apps/server/src/scheduledTasks/webhookTemplate.ts`, import/export paths (WI-1.08, WI-3.04), notifications
  (WI-1.04), audit (WI-1.03).
- **Acceptance:** a table of positive and negative samples per rule; a known fake token written through the
  server logger never reaches the log; transcripts in the database are not modified (the agent already saw
  its tool output; redaction applies at egress).
- **Tests:** `packages/shared/src/redaction.test.ts` table; one `serverLogger` case.
- **Security:** best effort, stated as such. **Privacy:** limits leakage through logs and exports.
- **Mobile:** none. **Upstream:** small hook in `serverLogger.ts`.
- **Conflicts:** none significant.

### WI-1.03 Hash-chained audit log

- **Category:** Security and recovery. **Features:** INF-08. **Effort:** M. **Depends on:** WI-1.01, WI-1.02.
- **New:** `apps/server/src/fork/audit/{AuditLog.ts,schema.ts}`, fork RPCs (list, verify), a viewer section
  injected into Diagnostics from `apps/web/src/fork/` (one line in
  `apps/web/src/components/settings/DiagnosticsSettings.tsx`), CLI `cmdeck audit verify` (one line in
  `apps/server/src/binCli.ts`).
- **Initial sources:** approval resolutions (subscribe to `thread.input_resolved` on `MilestoneHub`; no
  orchestration change), device pairing approvals (`apps/server/src/auth/http.ts`), remote MCP token
  create, use and revoke (`apps/server/src/auth/RemoteMcpTokens.ts`), secret reveals
  (`apps/server/src/secrets/SecretRequests.ts`), import runs. Later WIs add their own events.
- **Acceptance:** editing any stored row makes verify report the first broken index; pruning past retention
  keeps the chain verifiable (the prune event records the last pruned hash); no secret values stored
  (redactor applied).
- **Tests:** `AuditLog.test.ts` (`it.effect`: append, tamper, prune, verify); scope test for the RPCs.
- **Security:** tamper-evident only; the UI says so. **Privacy:** local only.
- **Mobile:** none. **Upstream:** one-line hooks in `auth/http.ts`, `RemoteMcpTokens.ts`, `SecretRequests.ts`
  if no service event exists to subscribe to.
- **Conflicts:** `DiagnosticsSettings.tsx` is a fork hotspot (477 changed lines); keep the change to one line.

### WI-1.04 Notification delivery service

- **Category:** Foundational infrastructure. **Features:** AUT-03, AUT-04, INF-10 (alerts), CHT-08, MSG-01..03
  (prerequisite). **Effort:** M. **Depends on:** WI-1.01, WI-1.02, WI-1.03.
- **Objective:** one channel-neutral delivery path for milestones and fork alerts
  ([ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §4.2, refinement of D5/D8).
- **New:** `apps/server/src/fork/notifications/{Notifications.ts,schema.ts}` (`notification_channels`,
  `notification_outbox`), `Notifications.alert(...)` for fork alerts, a fork RPC stream so the open app shows
  fork alerts through the existing client notifications (`apps/web/src/threadNotifications.ts`), a channel
  list in the Integrations settings route (`apps/web/src/routes/_chat.settings.integrations.tsx`, via a fork
  component).
- **Behaviour:** subscribes to `MilestoneHub` (`apps/server/src/milestones/MilestoneHub.ts`) only while a
  channel is enabled; per-channel rules (projects, kinds, quiet hours); suppression of quiet turns and
  incognito/temporary threads; per-channel rate limit; outbox with backoff; dedupe by milestone id;
  reconciliation of pending approvals at start-up.
- **Acceptance:** no channel means no subscription fibre (egress test row); a milestone published twice
  yields one outbox row per channel; a failing channel retries with backoff and records the failure; bodies
  are redacted.
- **Tests:** `Notifications.test.ts` with a fake channel; `TestClock` for backoff; await `Deferred`s.
- **Security:** channel credentials are secret references. **Privacy:** nothing sent without a configured
  channel. **Mobile:** official app push stays unavailable (D8). **Upstream:** no upstream edit.
- **Conflicts:** none.

### WI-1.05 Scheduler: cron, failure auto-pause, quota hold

- **Category:** Automation and monitoring. **Features:** AUT-01, AUT-07. **Effort:** M. **Depends on:** WI-0.03.
- **Objective:** cron expressions with a timezone, consecutive-failure auto-pause, and parking a task until
  a known usage reset instead of re-firing.
- **Files:** `packages/contracts/src/scheduledTask.ts` (`cron` schedule type; failure policy),
  `apps/server/src/scheduledTasks/Schedule.ts` (`nextScheduledRunAt`), `ScheduledTaskService.ts`,
  `apps/server/src/workflows/triggers.ts` (optional `cron(...)` trigger sharing the same helper),
  `apps/server/src/usage/UsageLimitSources.ts` (read-only), the MCP `schedule_task` tool schema in
  `apps/server/src/mcp/toolkits/orchestrator/tools.ts`, `apps/web/src/routes/_chat.settings.scheduled-tasks.tsx`
  and its form component.
- **Source:** behaviour from Kiro (`kc/cron_service`), Podium (single-flight, one late fire), Hermes
  `quota_hold.py`; a small cron library only if needed (ARCHITECTURE_PROPOSAL §5).
- **Acceptance:** `0 9 * * 1-5` in `Europe/London` fires at 09:00 local across both DST changes; invalid
  expressions are rejected at upsert with a readable error; N consecutive failures pause the task and show
  why; a task whose provider account is at its limit fires once after the reported reset; a decode test
  with the pre-change schema drops cron rows without failing the list (`ForwardCompatibleArray`,
  `scheduledTask.ts:273`).
- **Tests:** `Schedule.test.ts` DST table; `ScheduledTaskService` cases for auto-pause and quota hold with
  `TestClock`; contract decode test; evals for the `schedule_task` description.
- **Security:** none new. **Privacy:** none. **Mobile:** cron tasks are hidden in older official apps until
  upstream adopts the type. **Upstream:** open an upstream PR first; keep the fork change in the same shape
  so it disappears on acceptance.
- **Conflicts:** owns `ScheduledTaskService.ts` and `scheduledTask.ts` (scheduler lane: then WI-2.11,
  2.13, 2.12).

### WI-1.06 Workflows: trust gate, presets, default on

- **Category:** Autonomous execution. **Features:** AGT-05, AUT-02 (prerequisite). **Effort:** M.
- **Depends on:** WI-1.01, WI-1.03, **A2**.
- **Objective:** make workflows safe to turn on and give CMDeck a way to ship presets.
- **Files:** `apps/server/src/workflows/WorkflowRuntime.ts` (hook before the dynamic `import(url)` at line
  151), new `apps/server/src/fork/workflowTrust/{WorkflowTrust.ts,schema.ts}` (`workflow_trust`: path,
  SHA-256, source preset|user, approved at), new `apps/server/src/fork/presets/` (preset files and
  manifest), fork RPCs (pending, approve, install preset), a "Needs approval" state in the workflows page
  via a fork component, fork command-palette entries, `packages/contracts/src/settings.ts:1585`
  (`workflowsEnabled` default per A2, guarded), `skills/t3-workflows/SKILL.md` (agents' files need user
  approval).
- **Acceptance:** a new or changed file in the workflows folder is not imported until approved (assert with
  a marker side effect); editing an approved file revokes approval; "Install preset" copies the file and
  records its hash as approved; approvals are audited; MCP has no approve tool.
- **Tests:** cases in `apps/server/src/workflows/WorkflowRuntime.test.ts`; `WorkflowTrust.test.ts`; skill
  evals per `evals/README.md`.
- **Security:** the boundary is user approval of exact bytes; approved code still runs with server rights.
- **Privacy:** none. **Mobile:** workflow agent steps are ordinary threads. **Upstream:** propose the trust
  gate upstream as a security fix.
- **Conflicts:** owns `WorkflowRuntime.ts` and `apps/server/src/fork/presets/` (workflow lane).

### WI-1.07 Memory store core

- **Category:** Memory and intelligence. **Features:** MEM-01, MEM-02 (store side), MEM-04, MEM-05 (scope),
  MEM-06, MEM-07 (FTS), MEM-08 (ranking). **Effort:** L. **Depends on:** WI-1.01, WI-1.02.
- **Objective:** the memory module in [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §4.1, without UI
  beyond what is needed to test it.
- **New:** `apps/server/src/fork/memory/{MemoryStore.ts,MemoryAccess.ts,retrieval.ts,TurnContext.ts,mcpTools.ts,schema.ts}`,
  `packages/contracts/src/fork/memory.ts`.
- **Hook:** turn-context contributor call in the candidate seam
  `apps/server/src/orchestration-v2/ProviderTurnStartService.ts` (confirm against
  `ThreadMessageIntake.ts` and `packages/shared/src/composerContextReferences.ts`). The block goes into the
  provider input, not the stored message.
- **Behaviour:** items, revisions, FTS5, `thread_memory_mode`, `memory_injections`; one access predicate;
  provenance and pending proposals; BM25 retrieval with a decay factor; contributor registry (memory first;
  bots, notes and state cards register later); fenced block with a character budget; MCP tools
  `memory_search`, `memory_remember` (creates a pending proposal unless the turn is user-authored),
  `memory_forget` (retire, reversible).
- **Acceptance:** incognito refuses writes and allows reads; temporary refuses both and injects nothing;
  pending items are never injected; accepting one injects it next turn; every write has a revision and
  revert restores it; `bot:` items are invisible outside that bot's thread; `repo:` items follow the project
  across worktrees; the provider input contains the fenced block and the stored message does not.
- **Tests:** `MemoryStore.test.ts`, `MemoryAccess` table test, retrieval ranking test, one turn-start
  integration test using `packages/provider-testing` to capture provider input (drain the effect worker);
  evals for the three tools.
- **Security:** scope predicate in code; regex screen is hygiene only. **Privacy:** local only, no
  embeddings or background inference here. **Mobile:** none (the block is not in the transcript).
- **Upstream:** one hook line in the turn-start service.
- **Conflicts:** owns the turn-context seam (memory lane). WI-2.04, 2.06, 2.15 register into it.

### WI-1.08 Importer framework

- **Category:** Foundational infrastructure. **Features:** CMD-19, CMD-20 and CMD-21 (prerequisite), INF-12.
  **Effort:** M. **Depends on:** WI-0.03.
- **Objective:** generalize `cmdeck import-from-t3` into `cmdeck import <source>` (D16).
- **Files:** new `apps/server/src/fork/import/Importer.ts` (registry; `ImportPlan`/`ImportItem` from
  `apps/server/src/fork/T3Import.ts`); keep `T3Import.ts` as the T3 source (the guard references
  `T3Import.importOfferIssues`); parameterize source and target (hard-wired at `T3Import.ts:541`);
  `apps/server/src/cli/importFromT3.ts` and `apps/server/src/binCli.ts` (new command; old one kept as an
  alias).
- **Acceptance:** `cmdeck import t3 --plan` matches today's `import-from-t3 --plan`; `--source <dir>` works;
  an unknown source lists the available ones; a backup is made before `--run`.
- **Tests:** extend `apps/server/src/fork/T3Import.test.ts`; registry test.
- **Security:** imported data is untrusted; secrets are filtered (`isInstallSecret`). **Mobile:** none.
- **Upstream:** fork-only files plus the `binCli.ts` guard line.
- **Conflicts:** `binCli.ts` with WI-1.03 (one line each).

### WI-1.09 Engine names from M3 (oMLX, Osaurus, Locals)

- **Category:** M3 functionality. **Features:** CMD-07, M3-10. **Effort:** S. **Depends on:** WI-0.03.
- **Files:** `apps/server/src/inference/InferenceServerRegistry.ts` (`ENGINE_BY_OWNER`, lines ~133-139),
  its test, `docs/user/local-models.md`.
- **Source:** M3 PR #32 at `m3code@6a8f1b0741` (MIT, already credited).
- **Acceptance:** servers reporting `owned_by` of `omlx`, `osaurus` or `locals` show the right engine; oMLX
  load is read from `/api/status`.
- **Tests:** rows in `InferenceServerRegistry.test.ts`. **Security / privacy / mobile:** none.
- **Conflicts:** none.

### WI-1.10 Default thread environment (M3-28)

- **Category:** M3 functionality. **Features:** CMD-12, M3-28. **Effort:** S. **Depends on:** WI-1.01.
- **Objective:** a client preference for which environment new threads start in.
- **Source:** M3 `f46a606ff` (#18), adapted as a web client setting (official mobile has its own flow).
- **Acceptance:** new threads use the chosen environment when it is connected; when it is not, the current
  environment is used and the composer says so; never a silent substitute (architecture rule in
  `docs/internals/01_architecture.md`).
- **Tests:** logic test beside the new-thread handler. **Mobile:** web/PWA only.
- **Conflicts:** none.

### WI-1.11 Bedrock and AWS guidance, Claude Bedrock preset

- **Category:** Optional AWS. **Features:** BRK-AUTH.01-.09, BRK-INF.*, BRK-COST.01-.03, BRK-KB/PRM (via MCP),
  AWS-01, AWS-02, AWS-03, AWS-04 (all documented, no native code). **Effort:** S. **Depends on:** WI-0.03.
- **Files:** `docs/user/providers-claude.md` (Amazon Bedrock section), new `docs/user/aws.md` (AWS MCP Server
  and awslabs servers per harness, inference-only IAM role, tags and Budgets with their lag, EC2 as a
  tailnet environment), a "Amazon Bedrock" preset in the provider instance dialog
  (`apps/web/src/components/settings/AddProviderInstanceDialog.tsx`) filling `CLAUDE_CODE_USE_BEDROCK`,
  `AWS_PROFILE`, `AWS_REGION`, `ANTHROPIC_DEFAULT_*_MODEL`.
- **Source:** [AWS_BEDROCK.md](AWS_BEDROCK.md) §4(a)(b).
- **Acceptance:** following the doc with an SSO profile runs a Claude thread on Bedrock; the preset stores
  profile names only; no code path reads `~/.aws/*` or calls AWS when no Bedrock instance exists (egress
  test row).
- **Tests:** logic test for the preset mapping. **Security:** documents IAM as the spending gate.
- **Privacy:** no SDK, no credential discovery. **Mobile:** none. **Upstream:** docs conflict at syncs.
- **Conflicts:** none.

### WI-1.12 Open any thread beside the current one

- **Category:** Small usability. **Features:** CHT-04. **Effort:** S. **Depends on:** WI-1.01
  (`rightPanelStore.ts`).
- **Objective:** let the user open any thread in the right panel, not only subagents, side chats and
  linked threads.
- **Files:** `apps/web/src/rightPanelStore.ts` (`ThreadSurface`), `apps/web/src/components/RightPanelTabs.tsx`,
  thread context menu.
- **Acceptance:** "Open beside" on any thread opens it with its composer in the right panel; phone widths
  open it as the existing sheet.
- **Tests:** a row in the `rightPanelStore` logic test. **Mobile:** PWA falls back to one pane.
- **Conflicts:** `rightPanelStore.ts` (after WI-1.01).

---

## Phase 2: features on the foundations

### WI-2.01 Spec → Task Runner preset

- **Category:** Autonomous execution. **Features:** AGT-01, DEV-03 (deduplicated into one preset).
  **Effort:** M. **Depends on:** WI-1.06.
- **Objective:** plan → approve → execute per step → verify → bounded retry/replan → review → report, as one
  workflow preset. Stopping after the approved spec is the Spec Builder.
- **New:** `apps/server/src/fork/presets/task-runner.ts`, command palette entry, `docs/user/task-runner.md`.
- **Builds on:** `agent` (`returns` schema), `ask`, `step`, `within` (`apps/server/src/workflows/`),
  worktree child threads, a final review `agent` step on a different provider (the CMD-16 pattern).
- **Acceptance:** a three-task spec runs each task in its own thread; the verify command gates progress; a
  failing step retries up to the limit, then pauses with `ask`; after a server restart, completed steps are
  not re-run; "stop after spec" produces only the spec document.
- **Tests:** a preset test **(new)** `apps/server/src/fork/presets/presets.test.ts` that loads every preset
  and runs this one with the replay/fake agent following `apps/server/src/workflows/Workflows.test.ts`;
  evals for the briefs.
- **Security:** the verify command runs as the server user; it is shown in the approval `ask`. Sandboxed
  execution arrives with WI-2.18. **Mobile:** steps are ordinary threads; approvals work on the official app
  (workflow `ask` surfaces as a thread input **(inferred)**).
- **Upstream:** none. **Conflicts:** presets folder (workflow lane).

### WI-2.02 Conductor thread and Work Ledger

- **Category:** Autonomous execution. **Features:** AGT-03, AGT-07. **Effort:** M. **Depends on:** WI-1.01,
  WI-1.06.
- **Objective:** a "Start conductor" action and a work ledger with split ownership, listed in the conductor's
  right-panel tab (not a board).
- **New:** `apps/server/src/fork/workLedger/{WorkLedger.ts,schema.ts,mcpTools.ts}` (`work_items`: conductor
  thread, worker thread, title, acceptance, conductor state, worker status, summary, artifacts, PR),
  MCP tools `work_brief`, `work_report`, `work_ledger_read`; a panel in `apps/web/src/fork/`.
- **Builds on:** `delegate_task`, `t3_thread_*`, parent wake on child settlement (upstream #43459,
  arrives with WI-0.03), plan/approval runtime modes.
- **Acceptance:** workers can write only worker fields (schema-enforced); worker text is stored as data and
  rendered escaped; the conductor wakes when a worker settles; archiving the conductor offers to stop its
  workers.
- **Tests:** `WorkLedger.test.ts` (field ownership); MCP tool cases following
  `apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts`; evals.
- **Security:** the "report is data, not a prompt" rule. "No write tools" for the conductor is only as strong
  as the provider's runtime mode; say so. **Mobile:** conductor and workers are ordinary threads.
- **Upstream:** none. **Conflicts:** fork panel registry (append).

### WI-2.03 Research Lab preset

- **Category:** Autonomous execution. **Features:** AGT-10. **Effort:** S. **Depends on:** WI-1.06.
- **New:** `apps/server/src/fork/presets/research-lab.ts`.
- **Behaviour:** scoping `ask` with an editable question list; bounded cycles of parallel `agent` steps
  (`within`); stop on stagnation (no new findings in K cycles) or max cycles; a reserved synthesis step that
  writes a markdown or HTML artifact.
- **Acceptance:** synthesis always runs, even after a stop; the artifact is attached to the final thread.
- **Tests:** a row in `presets.test.ts`; evals for the briefs. **Conflicts:** presets folder.

### WI-2.04 Bot profiles

- **Category:** Persistent agents. **Features:** AGT-02, MEM-05. **Effort:** M. **Depends on:** WI-1.07.
- **New:** `apps/server/src/fork/bots/{Bots.ts,schema.ts,mcpTools.ts}` (`bot_profiles`: name, instructions,
  project, thread, provider/model, runtime mode, memory scope, scheduled task ids, channel bindings); Bots
  list in Settings; a badge on bot threads; "New bot" command.
- **Behaviour:** creating a bot creates a pinned thread (existing `thread.pin` command) and a `bot:<id>`
  scope; bot instructions register as a turn-context contributor; schedules are ordinary scheduled tasks in
  `continue` mode targeting the bot thread; "Wake now" runs the task.
- **Acceptance:** one thread across scheduled runs; private memory invisible elsewhere; deleting a bot
  archives the thread and retires its memory (restorable); the bot shows as a pinned thread on the official
  app.
- **Tests:** `Bots.test.ts`; memory scope integration case. **Security:** bot instructions are user-authored
  and shown in the profile. **Upstream:** none. **Conflicts:** contributor registry (append).

### WI-2.05 Memory UI and memory modes

- **Category:** Memory and intelligence. **Features:** MEM-02, MEM-06. **Effort:** M. **Depends on:** WI-1.07.
- **New UI in `apps/web/src/fork/`:** Settings → Memory (filter by scope and status, edit, revision history
  with restore, pending proposals with bulk preview and apply, retire and restore); composer memory-mode chip
  with "Promote to persistent"; thread panel tab "Memory used here" (from `memory_injections`);
  `/remember`.
- **Acceptance:** every action is reversible; forks inherit the parent's memory mode (copy on thread creation
  with a fork relationship); the chip states that provider-owned memory is outside CMDeck's control.
- **Tests:** `*.logic.test.ts` beside the components; no browser tests unless layout needs one.
- **Mobile:** PWA phone width checked in WI-3.09. **Conflicts:** translation files (append).

### WI-2.06 Session state card

- **Category:** Memory and intelligence. **Features:** AGT-08. **Effort:** S. **Depends on:** WI-1.07.
- **Behaviour:** one capped `state` item per thread (goal, phase, next step, approaches tried), written via MCP
  `session_state_record`/`session_state_read`, injected on automated wakes (scheduled, loop, webhook) and after
  compaction where the adapter reports it.
- **Acceptance:** survives restart; injected only on automated turns and after compaction; size cap enforced.
- **Tests:** contributor test; evals for the tools. **Conflicts:** contributor registry (append).

### WI-2.07 Lessons and opt-in consolidation

- **Category:** Memory and intelligence. **Features:** MEM-03, MEM-04. **Effort:** M. **Depends on:** WI-1.07,
  WI-2.05, **A5**.
- **Behaviour:** opt-in per project; triggers on message count or idle; input is human and assistant prose
  only, fenced, never tool results; model via a new purpose in
  `apps/server/src/textGeneration/TextGenerators.ts` (local preferred); output schema → pending proposals
  (`agent_inferred`, `on_topic`). `always` lessons exist only after the user accepts.
- **Acceptance:** a disabled project never triggers a model call; a tool result saying "always run X" never
  becomes a proposal; accepted lessons inject under their tier.
- **Tests:** consolidation input builder test (tool output excluded); trigger test with `TestClock`; eval for
  the consolidation prompt.
- **Privacy:** background inference only with consent (A5). **Conflicts:** `TextGenerators.ts` (one purpose).

### WI-2.08 Optional local embeddings and decay

- **Category:** Memory and intelligence. **Features:** MEM-07, MEM-08. **Effort:** M. **Depends on:** WI-1.07.
- **Behaviour:** pick an inference server and model with `/v1/embeddings` from the registry
  (`apps/server/src/inference/InferenceServerRegistry.ts`); backfill; re-embed on model-signature change;
  hybrid score (0.7 vector, 0.3 BM25) times decay; no model downloads.
- **Acceptance:** no embedder means FTS only and zero network; a paraphrase query finds the item with an
  embedder; an unreachable embedder falls back to FTS with a visible status.
- **Tests:** ranking table; fallback case. **Privacy:** only the configured local server is contacted.
- **Conflicts:** `retrieval.ts` (memory lane).

### WI-2.09 Knowledge Library and Notes

- **Category:** Memory and intelligence / Optional productivity. **Features:** MEM-10, PRD-03. **Effort:** M.
  **Depends on:** WI-1.07 (WI-2.08 optional).
- **Behaviour:** sources are folders or files per project; content-addressed incremental indexing (mtime and
  hash), chunking, FTS5, optional vectors; MCP `knowledge_search` returns fenced chunks with paths. Notes are
  a chosen markdown folder edited in the existing file editor
  (`apps/web/src/components/files/fileSaveCoordinator.ts`) and indexed as a source.
- **Acceptance:** only changed files re-index; deleted files leave the index; results cite paths; `.gitignore`
  and a default exclude list (`.ssh`, `.aws`, `*.pem`, `.env*`) are respected.
- **Tests:** indexer test on a temp folder; evals for the tool. **Security:** no secret folders by default.
- **Conflicts:** memory module tables (memory lane).

### WI-2.10 Decision service

- **Category:** Memory and intelligence. **Features:** TLS-05, TLS-06, TLS-07, TLS-08. **Effort:** M.
  **Depends on:** WI-1.01, **A5**.
- **New:** `apps/server/src/fork/decisions/{Decisions.ts,points/*.ts}` ([ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §4.3).
- **Points shipped here:** model routing for automation-started threads (rules: task kind, budget/limit
  state from usage); memory narrowing (registers in `retrieval.ts`). Wake suppression is called by WI-2.12,
  risk annotation by WI-2.16.
- **Acceptance:** every point works with no model configured; model errors fall back to the rule; consent
  recorded per point; annotations cannot change a policy decision (test both directions).
- **Tests:** point tables; fallback cases. **Security:** never a gate. **Privacy:** no hosted endpoint, no
  downloads. **Conflicts:** none.

### WI-2.11 Check-script gate

- **Category:** Automation and monitoring. **Features:** AUT-02. **Effort:** M. **Depends on:** WI-1.05,
  WI-1.06 (reuses the file-trust table).
- **Behaviour:** a scheduled task can carry a check command (Sillage rule): exit 0 wakes the agent with the
  output as fenced data; exit 10 skips silently; anything else is a failure (counts toward auto-pause,
  notifies). A task may be script-only and report through notifications. Scripts run through `HostProcess`
  with a timeout and kill-tree, using an explicit interpreter (node, bash, pwsh). Agent-created or changed
  scripts need approval by hash.
- **Acceptance:** the skip path starts no turn and no model call; output is truncated and fenced; a modified
  script does not run until re-approved; works on Windows and Linux.
- **Tests:** `ScheduledTaskService` cases with a fake process runner. **Security:** scripts run as the server
  user (sandboxed later by WI-2.18). **Conflicts:** scheduler lane.

### WI-2.12 Monitor loops, heartbeats, quiet turns

- **Category:** Automation and monitoring. **Features:** AUT-03, AUT-04, CHT-08. **Effort:** M.
  **Depends on:** WI-1.04, WI-2.11 (WI-2.10 optional).
- **Behaviour:** MCP `monitor_start`/`monitor_stop` let an agent arm a loop on its own thread (interval or
  idle-after-turn, max cycles, expiry, stop sentinel), stored as a scheduled task in `continue` mode; a pure
  `decide()` (terminal, budget, dedup by output hash, coalesce); optional suppress-only wake decision.
  **Heartbeat (A6, decided 2026-11-26) means health monitoring**, not Kiro's HEARTBEAT.md: a deterministic
  scheduled check (no inference) that provider sessions are alive (age of last runtime event while a turn is
  running), linked environments are reachable, and any HTTP/TCP probes the user lists answer. It alerts once
  through the notification service when something stops responding and once when it recovers. MCP `nothing_to_report(note?)`, allowed only on automated turns, marks
  the run quiet (`quiet_turns` table); web renders a compact "Checked, nothing to report" row; notifications
  skip it.
- **Acceptance:** a hung provider session, an unreachable peer environment or a failing user probe raises one
  alert and one recovery notice, never one per check; loops stop at budget, expiry, sentinel or thread archive; a user message resets the idle
  timer but not the deadline; `nothing_to_report` is refused on user-started turns; quiet runs notify no one.
- **Tests:** `decide()` table; tool cases; evals. **Mobile:** the official app shows the tool call as a plain
  row. **Conflicts:** scheduler lane; `threadNotifications` (none: server-side suppression).

### WI-2.13 Event triggers for scheduled tasks

- **Category:** Automation and monitoring. **Features:** TLS-04 (provider-neutral post-event hooks).
  **Effort:** S. **Depends on:** WI-2.11.
- **Behaviour:** a schedule type `event` matching `MilestoneHub` kinds (run settled with outcome, needs input,
  PR wake, workflow events) with a project filter, running a prompt or a check script.
- **Acceptance:** fires once per event; never for its own thread; coalesces bursts.
- **Tests:** trigger matching table; loop-guard case. **Mobile:** hidden in old apps (forward-compatible
  array). **Upstream:** propose with the cron PR. **Conflicts:** scheduler lane.

### WI-2.14 Usage threshold alerts

- **Category:** Automation and monitoring. **Features:** INF-10 (alerts). **Effort:** S. **Depends on:** WI-1.04.
- **Behaviour:** user thresholds per account window from existing limit data
  (`apps/server/src/usage/UsageLimitSources.ts`) → `Notifications.alert` once per window. Budgets and turn
  stops wait for upstream #39893.
- **Acceptance:** crossing 80% alerts once per window per account; nothing without a channel.
- **Tests:** threshold crossing table. **Conflicts:** none.

### WI-2.15 Message pins

- **Category:** Small usability. **Features:** CHT-06 (pins; quoting exists). **Effort:** S. **Depends on:** WI-1.01.
- **Scope change (A6, 2026-11-26):** session notes (CHT-09) were dropped. The user judged them already covered
  by queued messages and thread send (`t3_queue`, `t3_thread_send`). Revisit only if a note that never
  starts a turn turns out to be needed.
- **Behaviour:** `message_pins` from message actions, listed in a thread tab with jump-to-message.
- **Acceptance:** pins persist and show on other web clients; official app unaffected.
- **Tests:** pin store test.
- **Mobile:** fork table, not orchestration events (ARCHITECTURE_PROPOSAL §12). **Conflicts:** fork panel
  registry (append).

### WI-2.16 Server-side approval policy

- **Category:** Security and recovery. **Features:** INF-05, TLS-04 (pre-tool deny), TLS-08 (annotation seam).
  **Effort:** M. **Depends on:** WI-1.03.
- **Behaviour:** an approval-request interceptor at ingestion (candidate seam
  `apps/server/src/orchestration-v2/ProviderEventIngestor.ts`) evaluates typed deny rules (command patterns,
  write-path floor, tool names) from managed policy (`apps/server/src/policy/ManagedPolicy.ts`) or fork
  settings before presentation or auto-approval; a deny is auto-declined with a visible reason and an audit
  row; annotators (WI-2.10) run after the policy.
- **Acceptance:** a shell approval reading a canary credentials file outside the workspace is declined
  whatever the prompt says; MCP tools cannot change rules; with no rules, behaviour is identical to today.
- **Tests:** rule table; integration with a fake adapter from `packages/provider-testing` emitting approval
  requests.
- **Security:** only applies when the harness asks (full-access modes do not); documented.
- **Upstream:** one hook line. **Conflicts:** owns the interceptor seam.

### WI-2.17 Encrypted secrets at rest

- **Category:** Security and recovery. **Features:** INF-06. **Effort:** M. **Depends on:** WI-1.01.
- **Behaviour:** AES-256-GCM envelopes for files written by `apps/server/src/auth/ServerSecretStore.ts`,
  implemented as a fork decorator of the store provided through `ForkLayer`. Data key: on desktop, wrapped
  with Electron `safeStorage` (`apps/desktop/src/electron/ElectronSafeStorage.ts`) and handed to the backend
  at spawn (mechanism to confirm in `apps/desktop/src/backend/`). Headless (A12, decided): on Linux with
  systemd and a TPM2 (`systemd-creds has-tpm2`), the key is sealed with `systemd-creds encrypt --with-key=tpm2`
  so a copied disk or backup cannot be decrypted. Otherwise a key file in a separate 0700 directory, the same
  norm as gh, Docker and SOPS. Docs state that neither stops a process running as the same user. One-time migration with backup.
- **Acceptance:** secret files contain no plaintext; a copied secrets directory cannot be decrypted without
  the key; a missing key produces a clear error and recovery steps, never silent loss; `import-from-t3`
  still filters install secrets.
- **Tests:** round trip, migration, wrong-key cases. **Security:** limits stated (ARCHITECTURE_PROPOSAL §9).
- **Upstream:** decorator avoids editing `ServerSecretStore.ts` (an EXC-U02 compile-break file).
- **Conflicts:** none.

### WI-2.18 Container sandbox runner (Docker, Apple `container`)

- **Category:** Remote execution / Security and recovery. **Features:** CMD-09, INF-09. **Effort:** L.
  **Depends on:** WI-1.01, WI-1.03.
- **Runtimes (A10, decided 2026-11-26):** Docker on every OS. On macOS 26 with Apple silicon, Apple's
  `container` CLI is a second runtime behind the same recipe; each container is a lightweight VM, so it
  isolates more strongly than Docker Desktop's shared VM. It cannot mount read-only, so the `.git` overlay
  becomes a copy and the UI says so. Seatbelt is **not** offered: it mostly duplicates the sandboxes
  Claude Code and Codex already apply, and it would confuse users. Windows Sandbox is WI-2.19/WI-4.06.
- **Behaviour:** per-thread or per-project "Run in container" with a recipe (image, mounts, network, limits)
  in fork settings; a Docker implementation of `AgentScope` (`packages/shared/src/AgentScope.ts`;
  `apps/server/src/process/agentScope.ts` is the systemd one) so the whole provider process and the thread's
  terminals run inside; worktree mounted at the same absolute path; `.git/config`, `config.worktree` and
  `hooks` read-only; credentials as an env-file; `--network none` by default; label `cmdeck.thread=<id>` and a
  start-up reaper; `docker` CLI via `HostProcess`. Port of Agent of Empires' mount table with MIT
  attribution.
- **Acceptance:** inside a sandboxed thread, a temp canary file outside the worktree is unreadable and
  `curl` fails under `none`; checkpoints and diffs still work (host side); archiving removes the container;
  restart reaps orphans; Docker missing disables the option with a reason; opting out is audited.
- **Tests:** argv construction table; an `it.live` integration test that runs only in a CI job with Docker
  (documented gate, not `it.skip`).
- **Security:** containers are not VMs; stated in UI and docs. **Privacy:** none.
- **Mobile:** threads behave the same. **Upstream:** watch #15350; migrate if upstream ships sandboxes.
- **Conflicts:** `agentScope.ts` or its layer wiring in `server.ts` (one line).

### WI-2.19 Windows Sandbox feasibility spike

- **Category:** Security and recovery. **Features:** CMD-10. **Effort:** S. **Depends on:** —
- **Objective:** decide whether a provider session can run in Windows Sandbox: a prototype `.wsb` with the
  worktree mapped and a provider CLI started by the logon command; measure start time, single-instance
  limit, edition requirements, persistence.
- **Acceptance:** a go/no-go recorded in the tracking issue with measurements; no product code merged.
- **Tests:** none. **Conflicts:** none.

### WI-2.20 Code Review Sage preset

- **Category:** Developer tools. **Features:** DEV-01 (chains CMD-14, CMD-15, CMD-16). **Effort:** M.
  **Depends on:** WI-1.06.
- **New:** `apps/server/src/fork/presets/code-review.ts`.
- **Behaviour:** trigger on watched or opened PRs (workflow `pullRequests` triggers); deterministic risk step
  (sensitive paths, lockfiles, CI config, large or binary changes); review `agent` step on a different
  provider; CI failure logs via existing `ci_logs`; output as a **draft** review (`pull_request_review`) or
  batched diff comments; review state per head SHA in the workflow store.
- **Acceptance:** nothing is posted without a user click unless the user enables auto-post; a new head SHA
  reviews only new commits.
- **Tests:** preset row in `presets.test.ts`; risk rules table; evals. **Conflicts:** presets folder.

### WI-2.21 Design Critique skill

- **Category:** Developer tools. **Features:** DEV-05. **Effort:** S. **Depends on:** —
- **New:** `skills/design-critique/SKILL.md` using `preview_snapshot`, `preview_resize`,
  `preview_set_appearance` with a rubric (layout at three widths, contrast, accessibility tree issues), plus
  a command palette prompt "Critique this preview".
- **Acceptance:** produces findings with screenshots at three widths and accessibility issues.
- **Tests:** evals for the skill text. **Conflicts:** none.

---

## Phase 3: integrations and optional modules

### WI-3.01 Messaging adapter interface + Telegram

- **Category:** Optional messaging. **Features:** MSG-02. **Effort:** M. **Depends on:** WI-1.04 (and WI-1.02,
  WI-1.03 through it); WI-2.04 for bot binding (optional).
- **New:** `apps/server/src/fork/messaging/{MessagingAdapter.ts,MessagingService.ts,telegram.ts,schema.ts}`;
  `grammy` loaded with dynamic `import()` only when enabled; channel setup in Integrations.
- **Behaviour:** long polling (no inbound port); allowlisted sender ids (empty list refuses to start); chat ↔
  thread mapping (a bot's thread or a chosen thread); inbound text becomes a turn; approvals use inline
  buttons that dispatch `runtime-request.respond` (`packages/contracts/src/orchestrationV2.ts:3743`) for the
  bound request id; silence denies; outbound through the notification outbox; every inbound command audited.
- **Acceptance:** a non-allowlisted sender gets no response and an audit row; an approval button resolves
  exactly its request once; disabling the channel stops polling immediately (egress row); token stored as a
  secret reference.
- **Tests:** adapter tests with a fake Telegram transport; approval binding test. **Privacy:** contacts
  `api.telegram.org` only when enabled. **Mobile:** none. **Conflicts:** none.

### WI-3.02 Slack (Socket Mode)

- **Category:** Optional messaging. **Features:** MSG-01. **Effort:** M. **Depends on:** WI-3.01.
- **Behaviour:** same interface; `@slack/bolt` or `@slack/socket-mode` lazily loaded; owner allowlist; Slack
  thread ↔ CMDeck thread; button approvals in DMs only.
- **Acceptance:** as WI-3.01, plus Enterprise Grid workspaces are refused unless allow-listed.
- **Tests:** fake socket transport. **Conflicts:** none.

### WI-3.03 Kiro Crew importer

- **Category:** Foundational infrastructure (migration). **Features:** CMD-20, INF-12, CMD-21 (Kiro part).
  **Effort:** L. **Depends on:** WI-1.05, WI-1.08, WI-2.04, WI-2.05 (WI-2.11 for script crons, optional).
- **New:** `apps/server/src/fork/import/KiroCrewSource.ts`.
- **Input:** Kiro's portability export zip, or a live `~/.kiro/crew` read-only (copy SQLite files before
  opening; Kiro writes WAL). Mapping per [research/kirocrew-agents-memory-automation-chat.md](research/kirocrew-agents-memory-automation-chat.md)
  §6: preferences and facts → `imported` pending memory items; lessons → pending proposals; bots → bot
  profiles; crons → **disabled** scheduled tasks (script and command jobs flagged for review); approved skills
  copied; MCP server definitions imported disabled. Never: secrets, telemetry ids, workflow Python, webhook
  tokens, `.pending` skills. Transcripts (A8, decided): **always imported** as read-only archived threads,
  marked as imported and excluded from memory extraction.
- **Acceptance:** dry run lists every item with its target and reason for skips; a run is idempotent
  (re-import skips existing ids); nothing imported is active without user review.
- **Tests:** fixture export zip built in the test (no real Kiro data); mapping table tests.
- **Security:** all content untrusted; Apache-2.0 NOTICE only if Kiro text is copied. **Conflicts:** none.

### WI-3.04 App-state snapshot export and import

- **Category:** Security and recovery. **Features:** INF-03. **Effort:** M. **Depends on:** WI-1.08, WI-1.02.
- **Behaviour:** `cmdeck import snapshot` / `cmdeck export snapshot`: consistent SQLite backup of
  `statev2.sqlite` (fork tables included) and settings, manifest with versions, secrets excluded by default,
  redacted text fields on export; refuses a bundle from a newer schema.
- **Acceptance:** export then import on a clean home restores threads, settings, memory and bots; worktrees and
  provider-owned data are listed as not included.
- **Tests:** round trip on a temp home. **Conflicts:** importer registry (append).

### WI-3.05 Automatic skill proposals

- **Category:** Memory and intelligence. **Features:** MEM-09, TLS-03 (writes harness skills). **Effort:** M.
  **Depends on:** WI-2.07.
- **Behaviour:** off by default; after consolidation, sessions with enough tool use and no sensitive paths
  produce a candidate `SKILL.md` (redacted, scripts validated) into a pending queue; approval writes it into
  the chosen provider's skill folder; unused skills archive after 30 days; never delete.
- **Acceptance:** nothing is written to a provider folder without approval; archived skills restore.
- **Tests:** candidate eligibility table; approve/archive cases; eval. **Conflicts:** none.

### WI-3.06 Auto-Improvement preset

- **Category:** Developer tools. **Features:** DEV-02. **Effort:** L. **Depends on:** WI-1.06, WI-2.01
  (shares the step/verify pattern); WI-2.18 optional.
- **Behaviour:** objective, metric command and baseline with a calibrated noise band; edit allowlist (paths);
  max iterations, time budget; each iteration in a fresh worktree child thread; keep if the metric beats
  baseline beyond noise and tests pass, else revert (discard the worktree); survivors drafted as a PR;
  results table as an artifact.
- **Acceptance:** edits outside the allowlist fail the iteration; budget stops the run; a reproducible results
  table records seeds and commands.
- **Tests:** preset row with a fake metric; allowlist check table. **Conflicts:** presets folder.

### WI-3.07 Ops Mission Control preset

- **Category:** Developer tools. **Features:** DEV-06. **Effort:** M. **Depends on:** WI-2.12, WI-2.13.
- **Behaviour:** sources are inbound webhooks (existing) and check-script pollers; each incident opens a thread
  with the evidence as fenced data; autonomy `observe` (default) or `propose`; any remediation is an `ask`
  approval; notifications on open and resolve.
- **Acceptance:** no remediation without approval; duplicate signals coalesce into one incident thread.
- **Tests:** preset row; coalescing case. **Conflicts:** presets folder.

### WI-3.08 LaTeX compile action and PPTX skill guide

- **Category:** Optional productivity. **Features:** PRD-01, PRD-02. **Effort:** M. **Depends on:** — (WI-2.18
  optional for sandboxed compile).
- **Behaviour:** a "Compile PDF" action for `.tex` files: tectonic preferred, pdflatex fallback,
  `-no-shell-escape`, `openout_any=p`, wall-clock timeout, in a container when the sandbox is enabled; output
  opens in the existing PDF viewer (`apps/web/src/components/files/PdfViewer.tsx`) with parsed errors. PPTX:
  a doc and optional skill pointing to the MIT-0 spec-driven presentation maker as an MCP server the user
  installs; viewer exists (`OpenXmlOfficeViewer.tsx`).
- **Acceptance:** no compiler installed hides the action; shell escape stays off; timeouts kill the process
  tree.
- **Tests:** compile-argument builder table; log parser table. **Conflicts:** none.

### WI-3.09 PWA behind Cloudflare Access

- **Category:** PWA and mobile compatibility. **Features:** CMD-23, CMD-04. **Effort:** M. **Depends on:** WI-2.05,
  WI-2.15 (fork surfaces to check).
- **Behaviour:** detect an expired Access session (WebSocket upgrade or fetch redirected to Access) and offer
  a re-login instead of an endless reconnect; optional server-side validation of `Cf-Access-Jwt-Assertion`
  against the team's keys as defence in depth (off by default); a phone-width pass over every fork surface.
- **Acceptance:** after Access expiry, the PWA shows a sign-in prompt and recovers; with validation on,
  requests without a valid assertion on the tunnel hostname are refused while LAN and Tailscale access is
  unaffected.
- **Tests:** detection logic test; JWT validation table. **Security:** additive to CMDeck's own auth.
- **Conflicts:** connection runtime files in `packages/client-runtime` (coordinate with syncs).

### WI-3.10 AWS credential environment scoping

- **Category:** Optional AWS. **Features:** BRK-AUTH.08. **Effort:** S. **Depends on:** WI-0.05 (A4 approved).
- **Behaviour:** `mergeProviderInstanceEnvironment` drops inherited `AWS_*` and `AWS_BEARER_TOKEN_BEDROCK`
  unless the instance declares them (`packages/provider-core/src/server/instanceEnvironment.ts`).
- **Acceptance:** a non-AWS instance spawns without AWS variables; a Bedrock instance gets exactly its
  declared ones.
- **Tests:** rows in the instance-environment test. **Conflicts:** same file as WI-0.05 (sequenced).

### WI-3.11 Web Push for the PWA

- **Category:** PWA and mobile compatibility. **Features:** CMD-23, NEW-A09 (approved A14, 2026-11-26).
  **Effort:** M. **Depends on:** WI-1.04, WI-3.09.
- **Behaviour:** a Web Push channel for the notification service. VAPID keys are generated locally on first
  enable and stored through the secrets store (WI-2.17 when present). A service worker in `apps/web` receives
  pushes and opens the thread on click. Subscriptions are bound to a device credential and revoked with it.
  Suppression rules from Agent of Empires: a per-thread cooldown, a short "still waiting" threshold before
  needs-input alerts, and nothing while a CMDeck tab is focused. Payloads carry a title, thread id and kind,
  never message text. They are encrypted end to end (RFC 8291), so the browser vendor's push service sees
  only ciphertext.
- **Acceptance:** with the channel enabled and a phone PWA subscribed through Cloudflare Access, a
  needs-input event produces one notification that opens the right thread. Disabled means no service worker
  registration and no outbound push (an egress test case). Revoking the device stops delivery.
- **Tests:** suppression decision table; subscription store test; payload contains no message text.
- **Dependencies:** `web-push` (MPL-2.0, weak file-level copyleft; fine as an unmodified dependency).
- **Privacy:** the only third party is the browser's push service (Apple, Google or Mozilla), which sees
  timing, not content. Documented. **Mobile:** the official T3 app is unaffected.
- **Conflicts:** `apps/web` service-worker registration and the notification channel registry (append).

---

## Phase 4: conditional and low priority

### WI-4.01 Agent Channels room thread

- **Category:** Autonomous execution. **Features:** AGT-09. **Effort:** M. **Depends on:** WI-2.02, **A13**.
- **Behaviour:** a room thread whose unmentioned messages go to an orchestrator thread and `@name` messages to
  bound specialist threads; specialists cannot dispatch or control sessions; messages are forwarded with
  `t3_thread_send`. Brakes and addressing limits are NEW-A02 (pending approval); a hop limit is included as a
  minimum safety rule.
- **Acceptance:** routing table holds; a forwarding loop stops at the hop limit.
- **Tests:** routing table. **Conflicts:** none.

### WI-4.02 Microsoft Teams adapter

- **Category:** Optional messaging. **Features:** MSG-03. **Effort:** M. **Depends on:** WI-3.01, **A7**.
- **Behaviour:** Bot Framework inbound webhook on the tunnel hostname with JWT validation, outbound to the
  conversation service URL, card approvals.
- **Acceptance:** requests with an invalid token are refused; nothing runs without a public URL configured.
- **Tests:** JWT validation table. **Conflicts:** HTTP route registration (one line).

### WI-4.03 Local engine manager (M3-09)

- **Category:** M3 functionality. **Features:** CMD-07. **Effort:** L. **Depends on:** WI-1.01.
- **Source:** `m3code@6a8f1b0741:apps/server/src/inference/LocalEngineManager.ts`, `LocalEngineAdapters.ts`,
  `packages/contracts/src/localEngines.ts`, adapted per [M3_CODE_ANALYSIS.md](M3_CODE_ANALYSIS.md) §4.1:
  Ollama, llama.cpp, LM Studio, MLX only; `HostProcess` instead of raw spawn; `providers:manage` scope for
  config; RPCs in the fork group. Scope (A9, decided 2026-11-26): a management panel (status, start/stop,
  pull/remove models, logs) plus per-engine install instructions with links. CMDeck never runs an installer or
  package manager itself.
- **Acceptance:** start/stop/pull for each engine; the started engine auto-registers; manager tests exist (M3
  tested only parsers).
- **Tests:** manager tests with a fake process runner. **Conflicts:** none after WI-1.01.

### WI-4.04 Element picker for streamed browser tabs

- **Category:** Developer tools. **Features:** DEV-04 (remote/PWA half). **Effort:** M. **Depends on:** —
- **Behaviour:** pick an element in a server-browser tab streamed to web (today desktop-only:
  `apps/desktop/src/preview/PickTarget.ts`) using the server's page (`apps/server/src/preview/ServerBrowser.ts`)
  to resolve DOM, styles and a screenshot into an `element` composer context.
- **Acceptance:** works from a PWA over Tailscale; respects the human/agent control lock.
- **Tests:** hit-test resolution logic. **Conflicts:** preview files (upstream-owned; small hooks).

### WI-4.05 Honest context breakdown

- **Category:** Small usability. **Features:** CHT-07. **Effort:** M. **Depends on:** WI-1.07.
- **Behaviour:** show what CMDeck injected (memory, notes, state card, attachments, composer contexts) by size,
  plus provider-reported token usage (`apps/web/src/components/chat/ThreadDetailsUsage.tsx`); label the rest
  "assembled by the provider" (A6).
- **Acceptance:** no category is shown that CMDeck cannot measure. **Tests:** aggregation logic test.

### WI-4.06 Windows Sandbox backend

- **Category:** Security and recovery. **Features:** CMD-10. **Effort:** L. **Depends on:** WI-2.18, WI-2.19 (go).
- **Behaviour:** a Windows Sandbox implementation behind the same runner interface, within the limits the spike
  measured.
- **Acceptance:** set by the spike. **Conflicts:** sandbox module.

---

## Not scheduled: covered or waiting

| Feature IDs                                              | Status           | Where it is covered or what it waits for                                                                                           |
| -------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AGT-04                                                   | Covered          | `delegate_task` with worktree isolation, native subagent tracking, workflow `within` pools.                                        |
| AGT-05 (engine)                                          | Covered          | Effect workflow engine; WI-1.06 only adds the trust gate and default.                                                              |
| AGT-06                                                   | Covered          | Failed-step resume (`workflow.ts` `StepRetry`, `Workflows.test.ts:1061`). Arbitrary earlier step: deferred.                        |
| AUT-05                                                   | Covered          | `PullRequestWatchService.ts`, CI log quotes (CMD-15), `ci_logs`/`ci_rerun`.                                                        |
| AUT-06                                                   | Covered          | `/api/hooks/:hookId/:token` with verification and filters; stale docs fixed in WI-0.07.                                            |
| AUT-07                                                   | Covered          | `UsageLimitRecoveryWorker.ts`; quota hold for scheduled tasks in WI-1.05; fallback chains wait for upstream #43605.                |
| CHT-01, CHT-02, CHT-03, CHT-05                           | Covered          | `ThreadSearch.ts`, `ThreadForkService.ts`, `t3_thread_*`, `t3_queue`/`QueuedRunOrder.ts`. Mobile reply/edit waits for #43754.      |
| CHT-06 (quoting)                                         | Covered          | Composer context `response`; pins in WI-2.15.                                                                                      |
| TLS-01                                                   | Covered          | `ServerBrowser.ts` + `SessionControl.ts` takeover.                                                                                 |
| TLS-02                                                   | Waiting          | Upstream #16530 / #16529; harness computer use already rendered.                                                                   |
| TLS-03                                                   | Harness-provided | Provider skills surfaced in composer; WI-3.05 writes approved skills into harness folders.                                         |
| INF-01                                                   | Covered          | Peer links and remote delegation; thread moves wait for #41771, numeric Tailscale for #43338, cross-project delegation for #28859. |
| INF-02                                                   | Covered          | Headless server and user service, remote MCP.                                                                                      |
| INF-04                                                   | Covered          | `ProviderRuntimeRecoveryService.ts`, `RestartContinuation.ts`, desktop backend recovery.                                           |
| INF-10 (budgets, breakdowns)                             | Waiting          | Upstream #39893, #29931, #42848, #31451, #33847. Alerts in WI-2.14.                                                                |
| INF-11, CMD-11                                           | Covered          | 12+ providers, ACP v1/v2 and Registry; goose as generic ACP.                                                                       |
| INF-12 (Claude, Codex, Pi sessions)                      | Covered          | `AgentSessionImporter.ts`, `AgentSessionScanner.ts`; Kiro in WI-3.03.                                                              |
| CMD-02, CMD-03, CMD-05, CMD-06                           | Covered          | After WI-0.01; Tailscale package; remote MCP with bearer tokens; no CMDeck service.                                                |
| CMD-07 (core)                                            | Covered          | M3 inference stack; names in WI-1.09; engine manager WI-4.03 (conditional).                                                        |
| CMD-13, CMD-14, CMD-15, CMD-16, CMD-17, CMD-19           | Covered          | Tray, batched diff comments, CI logs, second-model review, VCS, `import-from-t3`.                                                  |
| CMD-21 (OpenCode sessions)                               | Waiting          | Upstream #41296. Config imports from other agents: deferred.                                                                       |
| DEV-04 (desktop)                                         | Covered          | `PickTarget.ts`, element context; web half in WI-4.04.                                                                             |
| AWS-02, AWS-04, BRK-KB._, BRK-PRM._, BRK-COST.04/.07/.09 | Covered by MCP   | AWS MCP Server and awslabs servers configured in the harness, documented in WI-1.11.                                               |
| AWS-03 (native), AWS-05, BRK-AGC.02-.09, BRK-INF.08      | Deferred         | [AWS_BEDROCK.md](AWS_BEDROCK.md) §4(c).                                                                                            |
| BRK-AGC.01                                               | Not selected     | Classic Bedrock Agents are closed to new sign-ups.                                                                                 |
| Host extensions                                          | Waiting          | Upstream #34534; reconsider module packaging if it merges.                                                                         |
| Checkpoint restore over MCP                              | Waiting          | Upstream #21808–#21810 (stale).                                                                                                    |
| Machine monitoring for ops                               | Waiting          | Upstream #36693, #27253.                                                                                                           |

Pending approval, not scheduled: NEW-A01..A13 and NEW-B01..B06 from competitive research (NEW-B02 merged into
NEW-A01), and NEW-C01..C06 from unselected Kiro features (NEW-C01 "merge a fork back as a note", a variant of the
existing KCX-05 merge-back; C02 = KCX-17; C03 = KCX-14 bot goals; C04 = KCX-15; C05 = KCX-T06; C06 = KCX-T10;
KCX-T07 is folded into NEW-B06). See [NEW_FEATURE_PROPOSALS.md](NEW_FEATURE_PROPOSALS.md). Where a
scheduled WI would host one (NEW-A09 Web Push is now approved as WI-3.11; NEW-A02 brakes in WI-4.01, NEW-B03 stuck detector in
WI-2.12, NEW-A01 content envelopes (ex NEW-B02) in WI-1.07), the WI leaves a clean extension point and does not
build it. WI-4.01's hop limit is a minimum safety rule, not NEW-A02.

## Parallelization plan

### Lanes

Work runs in lanes. Inside a lane, items are sequential because they share files. Across lanes, items run in
parallel worktrees once their dependencies merge.

| Lane                     | Owner of                                                                    | Sequence                                                 |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Plumbing** (one agent) | `scripts/fork/*`, upstream merge, every one-line hook                       | 0.01 → 0.02 → 0.03 → 1.01, then each later upstream sync |
| **Privacy**              | `favicon.ts`, desktop updates, `instanceEnvironment.ts`, `cliRelease.ts`    | 0.05 → 0.04 → 0.06; 0.05 → 0.08; later 3.10              |
| **Security**             | `fork/audit`, redaction, policy seam, secrets decorator                     | 1.02 → 1.03 → 2.16; 2.17 any time after 1.01             |
| **Notify / messaging**   | `fork/notifications`, `fork/messaging`                                      | 1.04 → 2.14 → 3.01 → 3.02 → 4.02                         |
| **Scheduler**            | `ScheduledTaskService.ts`, `Schedule.ts`, `scheduledTask.ts`, `triggers.ts` | 1.05 → 2.11 → 2.13 → 2.12                                |
| **Workflows**            | `WorkflowRuntime.ts`, `fork/presets/`, `fork/workflowTrust`                 | 1.06 → 2.01 → 2.03 → 2.20 → 3.06 → 3.07                  |
| **Memory**               | `fork/memory`, the turn-context seam, `TextGenerators.ts` purposes          | 1.07 → 2.05 → 2.06 → 2.07 → 3.05; 2.08 → 2.09            |
| **Agents**               | `fork/bots`, `fork/workLedger`, `fork/threadAnnotations`                    | 2.02 (after 1.06); 2.04 → 2.15 (after 1.07); 4.01        |
| **Sandbox**              | `fork/sandbox`, `AgentScope` wiring                                         | 2.19 (any time) → 2.18 → 4.06                            |
| **Import**               | `fork/import`, `T3Import.ts`, `binCli.ts` import commands                   | 1.08 → 3.04 → 3.03                                       |
| **Independent**          | own files only                                                              | 0.07, 0.09, 1.09, 1.11, 2.10, 2.21, 3.08, 4.04, 4.05     |
| **Web shell**            | `rightPanelStore.ts`, `CommandPalette.tsx` beyond the hook                  | 1.12 after 1.01                                          |

Maximum useful concurrency after WI-1.01: about eight lanes (security, notify, scheduler, workflows, memory,
sandbox, import, independent).

### Hotspot ownership

| Hotspot                                                  | Why it conflicts                                    | Rule                                                                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/ws.ts`, `packages/contracts/src/rpc.ts` | 429 and 162 fork-changed lines, high upstream churn | Only WI-1.01 edits them. Later WIs add RPCs in `packages/contracts/src/fork/*.ts` and register one line in `packages/contracts/src/fork/rpc.ts` (append-only). |
| `apps/server/src/server.ts`                              | Layer pipe conflicted in the last sync              | Only WI-1.01 (and WI-2.18 if the `AgentScope` layer must be provided there). Others add to `ForkLayer.ts`.                                                     |
| `apps/server/src/mcp/McpHttpServer.ts`                   | 273 fork lines                                      | Only WI-1.01. Others append to `apps/server/src/fork/mcpToolkits.ts`.                                                                                          |
| `apps/server/src/persistence/ForkSchema.ts`              | Every module adds tables                            | Each module owns `schema.ts`; one appended call line per WI.                                                                                                   |
| `packages/contracts/src/settings.ts`                     | Upstream settings churn; guarded defaults           | WI-0.04, 0.05 and 1.06 edit it directly (sequenced); everything else uses `packages/contracts/src/fork/settings.ts`.                                           |
| `packages/contracts/src/clientRpcPermissions.ts`         | Scope table                                         | Only WI-1.01; fork scopes appended in the fork file.                                                                                                           |
| `ScheduledTaskService.ts`, `scheduledTask.ts`            | 2,697-line upstream service                         | Scheduler lane only, in order.                                                                                                                                 |
| `WorkflowRuntime.ts`                                     | Upstream engine                                     | WI-1.06 only.                                                                                                                                                  |
| `ProviderTurnStartService.ts`                            | Turn path                                           | WI-1.07 only; others register contributors.                                                                                                                    |
| `ProviderEventIngestor.ts`                               | Approval path                                       | WI-2.16 only; WI-2.10 registers an annotator.                                                                                                                  |
| `apps/web/src/rightPanelStore.ts`, `CommandPalette.tsx`  | 234 fork lines in the palette                       | WI-1.01 adds the fork surface and command source; WI-1.12 is the only later direct edit.                                                                       |
| `DiagnosticsSettings.tsx`                                | 477 fork lines                                      | One line in WI-1.03.                                                                                                                                           |
| `apps/web/src/i18n/translations/*.json`                  | Every UI WI adds keys                               | Append keys in a `cmdeck.*` namespace; after rebase run `vp run i18n:generate` instead of hand-merging.                                                        |
| `scripts/fork/guard.sh`                                  | Every hook adds a `required` line                   | Append-only; conflicts are trivial.                                                                                                                            |

### Conflict matrix (non-obvious pairs)

| Pair                                  | Shared surface                                   | Resolution                                                                         |
| ------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| WI-0.04 / WI-0.05                     | `settings.ts`                                    | Land 0.05 first.                                                                   |
| WI-0.05 / WI-0.08                     | `cliRelease.ts`                                  | 0.05 first.                                                                        |
| WI-0.05 / WI-3.10                     | `instanceEnvironment.ts`                         | Sequenced by phase.                                                                |
| WI-1.03 / WI-1.08                     | `binCli.ts`                                      | One line each; either order.                                                       |
| WI-1.05 / WI-2.11 / WI-2.12 / WI-2.13 | scheduler files, `scheduledTask.ts` schema union | Scheduler lane order.                                                              |
| WI-1.06 / WI-2.11                     | file-trust table                                 | 2.11 reuses 1.06's table; no new trust store.                                      |
| WI-1.07 / WI-2.04 / WI-2.06 / WI-2.15 | contributor registry                             | Append-only registrations after 1.07.                                              |
| WI-2.10 / WI-2.12 / WI-2.16           | decision points                                  | 2.10 lands the service; 2.12 and 2.16 call it when present and fall back to rules. |
| WI-2.01 / WI-3.06                     | preset step helpers                              | Extract shared helpers in 2.01; 3.06 reuses them.                                  |
| WI-0.03 / everything                  | merge                                            | Rebase after each sync; schedule syncs between lane merges, not during.            |

## Top 10 priorities

Ranked against §12.8: usefulness, value to current users, value for a Bedrock developer leaving Kiro Crew,
complexity, dependencies unlocked, maintenance, merge impact, privacy and reliability.

| Rank | WI                                                          | Why                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **WI-0.03** (with WI-0.02) Upstream sync                    | 300+ upstream fixes including permission hardening and a privacy fix; keeps the official app compatible; unblocks `import-from-t3` for v0.1.13 users; every other WI rebases on it. Guard and typecheck stop silent breakage. |
| 2    | **WI-0.01** Merge PR #23                                    | Shipped crash in v3; S effort; zero risk.                                                                                                                                                                                     |
| 3    | **WI-0.04, WI-0.05, WI-0.06** Privacy fixes and egress test | CMDeck's reason to exist; closes a per-link leak to Google and three unswitchable polls, then locks the result in CI. All S/M.                                                                                                |
| 4    | **WI-1.01** Fork extension seams                            | Unlocks every fork feature and cuts the recurring merge cost in `ws.ts`, `rpc.ts`, `server.ts`, `McpHttpServer.ts`.                                                                                                           |
| 5    | **WI-0.08** Release artifacts                               | SSH environments and headless installs fail closed today; remote execution on user machines (CMD-12) depends on it.                                                                                                           |
| 6    | **WI-1.07** Memory store core                               | The largest gap for someone leaving Kiro Crew (MEM-* are mostly absent); provider-neutral; foundation for bots, lessons, knowledge.                                                                                           |
| 7    | **WI-1.05** Scheduler extensions (then WI-2.11)             | Cron and check-script gates give cheap monitoring without inference; small, upstreamable, many items depend on them.                                                                                                          |
| 8    | **WI-1.04** Notifications (then WI-3.01 Telegram)           | With relay push gone, CMDeck has no way to reach a user away from the app; alerts, heartbeats and approvals need it.                                                                                                          |
| 9    | **WI-1.06** Workflow trust gate (then WI-2.01 Task Runner)  | Closes a real code-execution path before workflows go default-on; makes the preset model possible.                                                                                                                            |
| 10   | **WI-1.11** Bedrock guidance and preset                     | S effort; the Bedrock developer's main need is already supported by the harnesses and only needs to be discoverable and scoped.                                                                                               |

Just outside: WI-2.18 Docker sandbox (an explicit CMDeck requirement, but L, and its limits are real) and
WI-2.16 approval policy.

## Quick wins and major projects

**Quick wins (S, high value):** WI-0.01, WI-0.02, WI-0.04, WI-0.05, WI-0.07, WI-0.09, WI-1.09, WI-1.11, WI-1.12,
WI-2.03, WI-2.06, WI-2.14, WI-2.21, WI-3.10.

**Major projects:** WI-1.07 memory store (L), WI-2.18 Docker sandbox (L), WI-3.03 Kiro importer (L), WI-3.06
Auto-Improvement (L), WI-4.03 engine manager (L, conditional), WI-4.06 Windows Sandbox (L, conditional), and
WI-0.03 plus WI-1.01, which are M in effort but touch every hotspot.

## Foundational items (do early)

| WI               | Unlocks                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| WI-0.02, WI-0.03 | Everything (rebase base, upstream fixes).                                          |
| WI-0.06          | Every optional module's "inert when disabled" check.                               |
| WI-1.01          | All fork RPCs, settings, MCP tools, panels, commands.                              |
| WI-1.02          | Notifications, audit, exports, messaging.                                          |
| WI-1.03          | Policy, sandbox opt-outs, messaging, workflow approvals.                           |
| WI-1.04          | Alerts, heartbeats, quiet turns, messaging.                                        |
| WI-1.05          | Check scripts, monitor loops, event triggers, Kiro cron import.                    |
| WI-1.06          | Every preset (Task Runner, Research Lab, Code Review Sage, Auto-Improvement, Ops). |
| WI-1.07          | Bots, lessons, embeddings, knowledge, notes, state cards, Kiro memory import.      |
| WI-1.08          | Kiro import, snapshots.                                                            |

## Deferred despite being desirable

| Item                                                                                            | Feature IDs                          | Reason                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retry from an arbitrary earlier workflow step                                                   | AGT-06                               | Needs an engine change in upstream code; propose upstream. Failed-step retry already exists.                                                       |
| Native Bedrock/AgentCore/Guardrails/KB UIs, EC2 launcher, S3 drive, SageMaker decision provider | AWS-02..05, BRK-AGC, BRK-PRM, BRK-KB | MCP servers and the console cover them for one user; native UI adds AWS SDK weight and ongoing cost risk ([AWS_BEDROCK.md](AWS_BEDROCK.md) §4).    |
| Usage budgets and turn stops                                                                    | INF-10                               | Upstream is actively building them (#39893 and others).                                                                                            |
| Computer use                                                                                    | TLS-02                               | Upstream #16530; harness computer use already works.                                                                                               |
| Repo-map context selection (Aider-style)                                                        | TLS-06                               | Needs tree-sitter queries per language; memory narrowing covers the first need.                                                                    |
| `sqlite-vec`, vector or graph databases                                                         | MEM-07                               | Brute force is enough at memory scale; extensions are disabled.                                                                                    |
| Signed audit checkpoints, mediated secret dispatch (KCX-T07, folded into proposal NEW-B06)      | INF-08, INF-06                       | Useful hardening once the base log and encryption exist.                                                                                           |
| Container egress allowlists                                                                     | INF-09                               | Needs a proxy; `none` or a user network first.                                                                                                     |
| Capability-aware remote scheduling                                                              | INF-01                               | The client load balancer covers today's need; upstream #41771 may change the model.                                                                |
| M3 local-model evals, Antigravity limits via `agy`, monospace option, shell-probe change        | M3-11, M3-15, M3-27, M3-30           | Dev-only, blocked on confirming a documented CLI surface, cosmetic, or unexplained perf trade-off ([M3_CODE_ANALYSIS.md](M3_CODE_ANALYSIS.md) §4). |
| Config imports from other agent tools (instructions, MCP configs)                               | CMD-21                               | Evaluate after the Kiro importer proves the mapping; Kiro's own onboarding importer (KCX-11) is the reference.                                     |
| Wikilinks and backlinks for Notes                                                               | PRD-03                               | Notes work as plain markdown first.                                                                                                                |

## Appendix: feature to work item index

Every selected and required ID, so nothing disappears in consolidation. "Covered" points to the Not scheduled
table.

| ID        | WI / status                      | ID       | WI / status                                |
| --------- | -------------------------------- | -------- | ------------------------------------------ |
| CMD-01    | 0.04, 0.05, 0.06, 0.03           | CMD-13   | Covered                                    |
| CMD-02    | 0.01, 0.07; covered              | CMD-14   | Covered                                    |
| CMD-03    | Covered; #43338 waiting          | CMD-15   | Covered (chained by 2.20)                  |
| CMD-04    | 3.09                             | CMD-16   | Covered (chained by 2.20)                  |
| CMD-05    | 0.01; covered                    | CMD-17   | Covered (0.03)                             |
| CMD-06    | Covered (constraint on all WIs)  | CMD-18   | 0.02, 0.03, 1.01                           |
| CMD-07    | 1.09, 4.03; covered              | CMD-19   | Covered; 1.08                              |
| CMD-08    | 0.08                             | CMD-20   | 3.03                                       |
| CMD-09    | 2.18                             | CMD-21   | 3.03 (Kiro); #41296 waiting; rest deferred |
| CMD-10    | 2.19, 4.06                       | CMD-22   | 0.09; constraint on all WIs                |
| CMD-11    | Covered; 0.05                    | CMD-23   | 3.09                                       |
| CMD-12    | 0.08, 1.10, 1.11                 |          |                                            |
| AGT-01    | 2.01                             | MEM-01   | 1.07                                       |
| AGT-02    | 2.04                             | MEM-02   | 1.07, 2.05                                 |
| AGT-03    | 2.02                             | MEM-03   | 2.07                                       |
| AGT-04    | Covered                          | MEM-04   | 1.07, 2.07                                 |
| AGT-05    | 1.06; engine covered             | MEM-05   | 1.07, 2.04                                 |
| AGT-06    | Covered; arbitrary-step deferred | MEM-06   | 1.07, 2.05                                 |
| AGT-07    | 2.02                             | MEM-07   | 1.07 (FTS), 2.08                           |
| AGT-08    | 2.06                             | MEM-08   | 1.07, 2.08                                 |
| AGT-09    | 4.01                             | MEM-09   | 3.05                                       |
| AGT-10    | 2.03                             | MEM-10   | 2.09                                       |
| AUT-01    | 1.05                             | CHT-01   | Covered                                    |
| AUT-02    | 2.11                             | CHT-02   | Covered                                    |
| AUT-03    | 2.12                             | CHT-03   | Covered                                    |
| AUT-04    | 2.12                             | CHT-04   | 1.12                                       |
| AUT-05    | Covered                          | CHT-05   | Covered                                    |
| AUT-06    | Covered; 0.07                    | CHT-06   | 2.15 (pins); quoting covered               |
| AUT-07    | Covered; 1.05                    | CHT-07   | 4.05                                       |
| TLS-01    | Covered                          | CHT-08   | 2.12                                       |
| TLS-02    | Waiting #16530                   | CHT-09   | Covered (A6)                               |
| TLS-03    | Harness-provided; 3.05           | INF-01   | Covered                                    |
| TLS-04    | 2.13, 2.16                       | INF-02   | Covered                                    |
| TLS-05    | 2.10                             | INF-03   | 3.04                                       |
| TLS-06    | 2.10                             | INF-04   | Covered                                    |
| TLS-07    | 2.10, 2.12                       | INF-05   | 2.16                                       |
| TLS-08    | 2.10, 2.16                       | INF-06   | 2.17                                       |
| DEV-01    | 2.20                             | INF-07   | 1.02                                       |
| DEV-02    | 3.06                             | INF-08   | 1.03                                       |
| DEV-03    | 2.01                             | INF-09   | 2.18                                       |
| DEV-04    | Covered (desktop); 4.04          | INF-10   | 2.14; budgets waiting                      |
| DEV-05    | 2.21                             | INF-11   | Covered                                    |
| DEV-06    | 3.07                             | INF-12   | Covered; 1.08, 3.03                        |
| AWS-01    | 1.11 (MCP)                       | PRD-01   | 3.08                                       |
| AWS-02    | 1.11 (MCP); native deferred      | PRD-02   | 3.08                                       |
| AWS-03    | 1.11 (doc); native deferred      | PRD-03   | 2.09                                       |
| AWS-04    | 1.11 (MCP)                       | MSG-01   | 3.02                                       |
| AWS-05    | Deferred                         | MSG-02   | 3.01                                       |
| BRK-AUTH  | 1.11, 3.10                       | MSG-03   | 4.02                                       |
| BRK-INF   | 1.11 (harness-provided)          | BRK-KB   | 1.11 (MCP); native deferred                |
| BRK-PRM   | 1.11 (MCP); native deferred      | BRK-AGC  | Deferred; .01 not selected                 |
| BRK-INFRA | 1.11                             | BRK-COST | 1.11; existing estimates                   |

Inherited upstream features kept without a WI (brief §3): workflows, scheduled tasks and webhooks, PR watch,
checkpoints, linked environments, server browser, device tools and SnapShot, managed policy, secret providers,
session importer, visual replies and file viewers, guest links (hidden without Connect), thread search, fork,
queue, goals. M3-derived features kept: inference stack, E2EE, OMP, Vikunja, LLM Gateway, Add project dialog,
SQLite performance settings. No WI reintroduces telemetry, T3 Connect dependencies or boards.
