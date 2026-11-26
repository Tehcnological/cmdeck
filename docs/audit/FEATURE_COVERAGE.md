# Feature coverage verification

Brief §12.9 and §14 step 13. Audit date 2026-11-26, CMDeck at `4a2f27d590`. This file cross-references every
selected Kiro Crew capability (brief §5) and every existing CMDeck requirement (brief §4) against
[IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), lists inherited functionality that must be kept, and
records the cross-document quality review. The per-ID source of truth is the `work_items` column (28th) of
[FEATURE_MATRIX.csv](FEATURE_MATRIX.csv); the tables below are generated from it.

`work_items` values: `WI-<phase>.<nn>` (scheduled), `covered:<where>` (existing code), `waiting:upstream#<pr>`,
`deferred[:reason]`, `proposed[:NEW-xnn]`, `not-selected`, `excluded`. A row may combine several.

## Summary

> **Update 2026-11-26 (after approvals A1–A15):** the roadmap has 59 WIs. CHT-09 moved from WI-2.15 to
> "covered by existing" (so 59 selected Kiro features have WIs and 13 are covered or waiting), and NEW-A09 is
> now approved scope (WI-3.11). Counts below predate this update. See [RESEARCH_LEDGER.md](RESEARCH_LEDGER.md#approvals-2026-11-26).

| Set                                                                       | Count                                     | With a WI | Covered by existing code or waiting only | Deferred only | Missing |
| ------------------------------------------------------------------------- | ----------------------------------------- | --------- | ---------------------------------------- | ------------- | ------- |
| Selected Kiro Crew IDs (AGT, MEM, AUT, CHT, TLS, INF, DEV, AWS, PRD, MSG) | **73** (brief §5: 10+10+7+9+8+12+6+5+3+3) | 60        | 12                                       | 1 (AWS-05)    | **0**   |
| Existing CMDeck requirements (CMD-01..23)                                 | **23**                                    | 19        | 4                                        | 0             | **0**   |

Assertions checked by `validate_matrix.py` (scratchpad, run after every matrix edit): 260 rows × 28 columns,
260 unique IDs, exactly 73 selected Kiro rows and 23 CMD rows, every row has a non-empty well-formed
`work_items` value, every WI ID it names is defined in the roadmap, and all 58 roadmap WIs are referenced by at
least one matrix row.

Of the 73 selected items, 28 (38%) are already in CMDeck or harness-provided (`Existing` or `Harness-provided`
actions), 23 extend existing services (`Partial — extend`) and 22 need new subsystems (`New — port or
implement`, MSG-03 behind approval A7).

## 1. Selected Kiro Crew capabilities (73)

| ID     | Name                             | CMDeck status      | Final disposition                                                                      | Notes                                                                                               |
| ------ | -------------------------------- | ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| AGT-01 | Task Runner                      | Partial            | WI-2.01                                                                                | Spec Builder and Task Runner are one preset (DEV-03 deduplicated into it).                          |
| AGT-02 | Persistent Bots                  | Partial            | WI-2.04                                                                                | D7: bot = pinned thread + profile; official app sees a pinned thread.                               |
| AGT-03 | Conductor mode                   | Implemented+tested | WI-2.02                                                                                | Any thread already conducts via `delegate_task`/`t3_thread_*`; WI adds a start action and ledger.   |
| AGT-04 | Parallel subagents               | Implemented+tested | covered by existing `delegate_task+workflow within`                                    | —                                                                                                   |
| AGT-05 | Dynamic Workflows                | Experimental       | WI-1.06; covered by existing `effect/workflow engine`                                  | Engine exists (Labs). WI-1.06 adds the file trust gate; graduation needs A2.                        |
| AGT-06 | Selective workflow retry         | Experimental       | covered by existing `workflow.ts StepRetry/resume`; deferred (arbitrary-step retry)    | Failed-step resume exists (`workflow.ts`, `Workflows.test.ts:1061`). Arbitrary-step retry deferred. |
| AGT-07 | Work Ledger                      | Partial            | WI-2.02                                                                                | Kiro meaning (conductor work-item ledger); listed in a panel, not a board.                          |
| AGT-08 | Session Ledger                   | Partial            | WI-2.06                                                                                | Kiro meaning (state card), stored as a memory `state` item.                                         |
| AGT-09 | Agent Channels                   | Partial            | WI-4.01                                                                                | Conditional on A13; hop limit included, NEW-A02 brakes not built.                                   |
| AGT-10 | Research Lab                     | Absent             | WI-2.03                                                                                | —                                                                                                   |
| MEM-01 | Persistent memory                | Harness-provided   | WI-1.07                                                                                | —                                                                                                   |
| MEM-02 | Editable memory                  | Harness-provided   | WI-1.07; WI-2.05                                                                       | —                                                                                                   |
| MEM-03 | Self-learning                    | Absent             | WI-2.07                                                                                | —                                                                                                   |
| MEM-04 | Repository-scoped lessons        | Harness-provided   | harness-provided; WI-1.07; WI-2.07                                                     | Harness files (CLAUDE.md/AGENTS.md) stay; `repo:` scope and lessons added.                          |
| MEM-05 | Private bot memory               | Absent             | WI-1.07; WI-2.04                                                                       | —                                                                                                   |
| MEM-06 | Incognito / temporary memory     | Absent             | WI-1.07; WI-2.05                                                                       | Promote-to-persistent (KCX-10) is the reverse state.                                                |
| MEM-07 | Semantic memory search           | Absent             | WI-1.07; WI-2.08                                                                       | FTS5 first; local embeddings optional, no vector DB.                                                |
| MEM-08 | Memory decay                     | Absent             | WI-1.07; WI-2.08                                                                       | —                                                                                                   |
| MEM-09 | Automatic skill creation         | Absent             | WI-3.05                                                                                | —                                                                                                   |
| MEM-10 | Knowledge Library                | Absent             | WI-2.09                                                                                | D6 as refined: files on disk + SQLite chunk index.                                                  |
| AUT-01 | Cron jobs                        | Implemented+tested | WI-1.05                                                                                | —                                                                                                   |
| AUT-02 | Deterministic scheduled scripts  | Experimental       | WI-1.06; WI-2.11                                                                       | Check-script gate reuses WI-1.06 trust table.                                                       |
| AUT-03 | Heartbeat monitoring             | Partial            | WI-1.04; WI-2.12                                                                       | A6: scheduled-task heartbeat preset of monitor loops, no HEARTBEAT.md.                              |
| AUT-04 | Monitor Loops                    | Harness-provided   | WI-1.04; WI-2.12                                                                       | —                                                                                                   |
| AUT-05 | PR monitoring                    | Implemented+tested | covered by existing `PullRequestWatchService.ts`                                       | —                                                                                                   |
| AUT-06 | Inbound webhooks                 | Implemented+tested | covered by existing `/api/hooks route`; WI-0.07                                        | Docs still describe a Connect tunnel; fixed by WI-0.07. HMAC-mandatory check open.                  |
| AUT-07 | Automatic quota recovery         | Implemented+tested | covered by existing `UsageLimitRecoveryWorker.ts`; WI-1.05; waiting on upstream #43605 | Quota hold for scheduled tasks in WI-1.05; fallback models wait for #43605.                         |
| CHT-01 | Session search                   | Implemented+tested | covered by existing `ThreadSearch.ts`                                                  | —                                                                                                   |
| CHT-02 | Session forking                  | Implemented+tested | covered by existing `ThreadForkService.ts`                                             | —                                                                                                   |
| CHT-03 | Cross-session control            | Implemented+tested | covered by existing `t3_thread_* MCP tools`                                            | —                                                                                                   |
| CHT-04 | Split-view conversations         | Partial            | WI-1.12                                                                                | Right panel already shows subagents/side chats/linked threads.                                      |
| CHT-05 | Editable queued messages         | Implemented+tested | covered by existing `t3_queue/QueuedRunOrder.ts`; waiting on upstream #43754           | Mobile reply/edit waits for upstream #43754.                                                        |
| CHT-06 | Message quoting and pinning      | Partial            | WI-2.15; covered by existing `composer response context (quoting)`                     | Quoting exists (composer `response` context); pins added.                                           |
| CHT-07 | Context breakdown                | Partial            | WI-4.05                                                                                | A6: honest partial breakdown.                                                                       |
| CHT-08 | Quiet-turn indicator             | Absent             | WI-1.04; WI-2.12                                                                       | `nothing_to_report` MCP tool on automated turns.                                                    |
| CHT-09 | Session notes                    | Absent             | Covered by existing queued messages / `t3_thread_send` (user decision A6, 2026-11-26)  | Dropped from WI-2.15 at the user's call; revisit if a no-turn note is needed.                       |
| TLS-01 | Live browser with human takeover | Implemented+tested | WI-0.03; covered by existing `ServerBrowser.ts+SessionControl.ts`                      | Takeover verified (`SessionControl.ts`); upstream hardening T3-U03 arrives with the sync.           |
| TLS-02 | Computer Use                     | Harness-provided   | harness-provided; waiting on upstream #16530                                           | Harness computer use already renders; native waits for upstream #16530/#16529.                      |
| TLS-03 | Markdown skills                  | Harness-provided   | harness-provided; covered by existing `harness skills`; WI-3.05                        | Provider skills surface in the composer; WI-3.05 writes approved skills to harness folders.         |
| TLS-04 | Lifecycle hooks                  | Harness-provided   | WI-2.13; WI-2.16                                                                       | Harness hooks stay; CMDeck adds provider-neutral event triggers and pre-tool deny.                  |
| TLS-05 | Jev model routing                | Partial            | WI-2.10                                                                                | D9 decision service replaces hosted Jev (excluded). Rules first, optional local model.              |
| TLS-06 | Jev context selection            | Partial            | WI-2.10                                                                                | Memory narrowing ships; repo-map selection deferred.                                                |
| TLS-07 | Jev wake decisions               | Partial            | WI-2.10; WI-2.12                                                                       | Wake suppression is called by WI-2.12.                                                              |
| TLS-08 | Jev risk flagging                | Partial            | WI-2.10; WI-2.16                                                                       | Annotation only, never a gate; runs after the WI-2.16 policy.                                       |
| INF-01 | Remote Crew                      | Experimental       | covered by existing `linked environments`; waiting on upstream #41771                  | Labs (linked environments). Thread moves wait for #41771.                                           |
| INF-02 | Headless gateway                 | Implemented+tested | covered by existing `headless server+remote MCP`                                       | —                                                                                                   |
| INF-03 | Snapshot and restore             | Partial            | WI-3.04                                                                                | —                                                                                                   |
| INF-04 | Crash and orphan recovery        | Implemented+tested | covered by existing `ProviderRuntimeRecoveryService.ts+RestartContinuation.ts`         | —                                                                                                   |
| INF-05 | Independent permission policies  | Implemented+tested | WI-0.03; WI-2.16                                                                       | Upstream permission fixes via sync; server-side deny rules added.                                   |
| INF-06 | Encrypted secrets vault          | Partial            | WI-2.17                                                                                | Electron safeStorage on desktop; file key on headless (A12).                                        |
| INF-07 | Credential redaction             | Partial            | WI-1.02                                                                                | Applied at egress (logs, exports, messages), not to stored transcripts.                             |
| INF-08 | Chained security audit log       | Absent             | WI-1.03                                                                                | Tamper-evident only.                                                                                |
| INF-09 | OS sandboxing                    | Harness-provided   | WI-2.18; WI-2.19; WI-4.06                                                              | Harness sandboxes stay; Docker runner shared with CMD-09.                                           |
| INF-10 | Usage limits and alerts          | Partial            | WI-1.04; WI-2.14; waiting on upstream #39893                                           | Threshold alerts only; budgets and stops wait for #39893/#29931.                                    |
| INF-11 | Alternative harnesses and ACP    | Implemented+tested | covered by existing `provider adapters+ACP`                                            | 12+ providers, ACP v1/v2; goose as generic ACP.                                                     |
| INF-12 | Agent onboarding importer        | Implemented+tested | WI-1.08; WI-3.03; covered by existing `AgentSessionImporter.ts`                        | Claude/Codex/Pi session import exists; framework generalised; Kiro source added.                    |
| DEV-01 | Code Review Sage                 | Implemented+tested | WI-2.20                                                                                | Chains existing CMD-14/15/16.                                                                       |
| DEV-02 | Auto-Improvement                 | Absent             | WI-3.06                                                                                | —                                                                                                   |
| DEV-03 | Spec Builder                     | Partial            | WI-2.01                                                                                | Deduplicated into the AGT-01 preset ("stop after spec").                                            |
| DEV-04 | Design Tweak                     | Implemented        | WI-4.04; covered by existing `PickTarget.ts (desktop)`                                 | Desktop picker exists (`PickTarget.ts`); WI adds streamed/PWA tabs.                                 |
| DEV-05 | Design Critique                  | Partial            | WI-2.21                                                                                | —                                                                                                   |
| DEV-06 | Ops Mission Control              | Partial            | WI-3.07                                                                                | —                                                                                                   |
| AWS-01 | AWS Control                      | Absent             | harness-provided; WI-1.11                                                              | Through AWS MCP Server, documented; no AWS SDK (D12).                                               |
| AWS-02 | S3 cloud drive                   | Absent             | harness-provided; WI-1.11; deferred (native)                                           | MCP-covered; native S3 drive deferred.                                                              |
| AWS-03 | EC2 launcher                     | Absent             | harness-provided; WI-1.11; deferred (native)                                           | EC2 host as a tailnet environment (CMD-12), documented; native launcher deferred.                   |
| AWS-04 | AWS artifact deployment          | Absent             | harness-provided; WI-1.11                                                              | MCP-covered.                                                                                        |
| AWS-05 | SageMaker decision models        | Absent             | deferred (AWS_BEDROCK.md §4(c))                                                        | Deferred until the decision service exists (D9 as refined).                                         |
| PRD-01 | Papyrus                          | Partial            | WI-3.08                                                                                | LaTeX compile action, sandboxed when WI-2.18 is enabled.                                            |
| PRD-02 | PPTX Maker                       | Partial            | harness-provided; WI-3.08                                                              | Skill guide to a user-installed MCP server; viewer exists.                                          |
| PRD-03 | Notes                            | Absent             | WI-2.09                                                                                | Markdown folder in the existing file editor, indexed by WI-2.09.                                    |
| MSG-01 | Slack                            | Absent             | WI-3.02                                                                                | Socket Mode, no inbound port.                                                                       |
| MSG-02 | Telegram                         | Absent             | WI-3.01                                                                                | Long polling, no inbound port.                                                                      |
| MSG-03 | Microsoft Teams                  | Absent             | WI-4.02                                                                                | Conditional on A7 (public endpoint + Azure Bot).                                                    |

## 2. Existing CMDeck requirements (23)

| ID     | Name                                                              | CMDeck status      | Final disposition                                                    | Notes                                                                              |
| ------ | ----------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| CMD-01 | Remove telemetry, analytics and unnecessary outbound requests     | Partial            | WI-0.02; WI-0.03; WI-0.04; WI-0.05; WI-0.06; WI-0.07                 | Telemetry code removed; remaining egress closed by 0.04/0.05, locked by 0.06.      |
| CMD-02 | Remove T3 Connect dependencies, keep remote functionality         | Implemented        | WI-0.01; WI-0.07                                                     | Connect code stays as dead code (A15); PR #23 fixes the MCP wizard crash.          |
| CMD-03 | Tailscale private connectivity between environments               | Implemented        | covered by existing `packages/tailscale`; waiting on upstream #43338 | Numeric Tailscale addresses wait for upstream #43338.                              |
| CMD-04 | Cloudflare Tunnel + Cloudflare Access remote web access           | Partial            | WI-3.09                                                              | Access-expiry handling and optional JWT validation.                                |
| CMD-05 | Self-hosted orchestration MCP server reachable over tailnet       | Implemented+tested | WI-0.01; covered by existing `McpHttpServer.ts+RemoteMcpTokens.ts`   | —                                                                                  |
| CMD-06 | No mandatory CMDeck-operated cloud service or paid infrastructure | Implemented        | covered by existing `constraint on all WIs`                          | Constraint on every WI (rule 9: no new automatic outbound request).                |
| CMD-07 | Local model providers: Ollama, LM Studio, llama.cpp               | Implemented+tested | WI-1.09; WI-4.03; covered by existing `M3 inference stack`           | Engine manager conditional on A9.                                                  |
| CMD-08 | Windows, macOS and Linux execution environments                   | Partial            | WI-0.08                                                              | Missing release artifacts and platforms; Windows test job.                         |
| CMD-09 | Per-thread Docker sandboxing                                      | Absent             | WI-2.18                                                              | Docker, network `none` by default; A10.                                            |
| CMD-10 | Windows Sandbox integration                                       | Absent             | WI-2.19; WI-4.06                                                     | Spike first; backend only on "go".                                                 |
| CMD-11 | Alternative harnesses: OpenCode, goose, ACP agents                | Implemented        | WI-0.05; covered by existing `provider adapters+ACP`                 | —                                                                                  |
| CMD-12 | Remote execution on user-owned machines                           | Partial            | WI-0.08; WI-1.10; WI-1.11                                            | SSH bootstrap needs CLI archives (A11).                                            |
| CMD-13 | Background execution and close-to-tray                            | Implemented+tested | covered by existing `desktop tray`                                   | —                                                                                  |
| CMD-14 | Batched diff comments                                             | Implemented+tested | covered by existing `batched diff comments`                          | —                                                                                  |
| CMD-15 | CI failures and logs fed back to agents                           | Implemented+tested | covered by existing `CI log quotes+ci_logs`; WI-2.20                 | —                                                                                  |
| CMD-16 | Independent second-model code review                              | Implemented+tested | covered by existing `second-model review`; WI-2.20                   | —                                                                                  |
| CMD-17 | Preserve Git, worktree and PR functionality                       | Implemented        | WI-0.03; covered by existing `VCS services`                          | Upstream VCS fixes arrive with the sync.                                           |
| CMD-18 | Preserve upstream workflow and orchestration capabilities         | Implemented        | WI-0.02; WI-0.03; WI-1.01                                            | Guard, sync and fork seams cut merge burden.                                       |
| CMD-19 | T3 Code migration utility                                         | Implemented+tested | WI-1.08; covered by existing `T3Import.ts`                           | `import-from-t3` generalised to `cmdeck import <source>`.                          |
| CMD-20 | Kiro Crew data import via the same migration framework            | Absent             | WI-3.03                                                              | Reads the Kiro export zip; nothing active without review; transcripts per A8.      |
| CMD-21 | Import from other agent environments (evaluate)                   | Partial            | WI-3.03; waiting on upstream #41296; deferred (config imports)       | Agent-session importer exists; OpenCode waits for #41296; config imports deferred. |
| CMD-22 | Official T3 mobile app compatibility                              | Partial            | WI-0.09; covered by existing `protocol 2 constraint`                 | Device check settles the pairing-retry conflict; push stays unavailable (D8).      |
| CMD-23 | Responsive CMDeck PWA via Cloudflare Tunnel/Access                | Partial            | WI-3.09; WI-3.11                                                     | Web Push (NEW-A09) approved 2026-11-26 (A14) and scheduled as WI-3.11.             |

The brief §6 AWS/Bedrock areas (BRK-*) are mapped the same way in the matrix: BRK-AUTH, BRK-INF, BRK-KB,
BRK-PRM.09-11, BRK-INFRA, BRK-COST → WI-1.11 (docs, preset, MCP servers); BRK-AUTH.08 → WI-3.10; native
BRK-KB/BRK-PRM UIs, BRK-AGC and BRK-INF.08 deferred ([AWS_BEDROCK.md](AWS_BEDROCK.md) §4(c)); BRK-AGC.01 not
selected (classic Bedrock Agents closed to new sign-ups).

## 3. Inherited functionality to retain

Brief §3 rules 1–3: these stay although none is in the selected Kiro list. No WI removes any of them. Where a WI
touches one, it extends it or swaps a fork variant for the identical upstream one.

### 3.1 Upstream T3 Code primitives (T3-01..27)

| ID    | Name                                         | CMDeck status      | Work items / disposition                         |
| ----- | -------------------------------------------- | ------------------ | ------------------------------------------------ |
| T3-01 | Durable workflows (Labs)                     | Experimental       | covered: `apps/server/src/workflows`; WI-1.06    |
| T3-02 | Scheduled tasks and inbound webhooks         | Implemented+tested | covered: `scheduledTasks`; WI-1.05               |
| T3-03 | delegate_task subagents and create_threads   | Implemented+tested | covered: `inherited upstream`                    |
| T3-04 | PR watch                                     | Implemented+tested | covered: `inherited upstream`                    |
| T3-05 | MCP orchestration server                     | Implemented+tested | covered: `inherited upstream`                    |
| T3-06 | Git checkpoints                              | Implemented+tested | covered: `inherited upstream`                    |
| T3-07 | Usage and quota tracking                     | Implemented+tested | covered: `inherited upstream`                    |
| T3-08 | Browser preview and automation               | Implemented+tested | covered: `inherited upstream`                    |
| T3-09 | Provider skills in composer                  | Implemented        | covered: `inherited upstream`                    |
| T3-10 | Project scripts and worktree setup           | Implemented        | covered: `inherited upstream`                    |
| T3-11 | Thread search                                | Implemented+tested | covered: `inherited upstream`                    |
| T3-12 | Thread fork, side chats and context handoff  | Implemented+tested | covered: `inherited upstream`                    |
| T3-13 | Editable message queue                       | Implemented+tested | covered: `inherited upstream`                    |
| T3-14 | Linked environments and remote delegation    | Experimental       | covered: `inherited upstream`                    |
| T3-15 | Milestones and MCP Events                    | Implemented+tested | covered: `MilestoneHub.ts`; WI-1.04 (subscriber) |
| T3-16 | Snooze, wake and settlement                  | Implemented+tested | covered: `inherited upstream`                    |
| T3-17 | Provider-native goals (/goal)                | Implemented        | covered: `inherited upstream`                    |
| T3-18 | Device tools and SnapShot                    | Implemented+tested | covered: `inherited upstream`                    |
| T3-19 | Managed policy                               | Implemented+tested | covered: `inherited upstream`                    |
| T3-20 | Secret providers and secret requests         | Implemented+tested | covered: `inherited upstream`                    |
| T3-21 | Agent session importer                       | Implemented+tested | covered: `inherited upstream`                    |
| T3-22 | Visual replies and file viewers              | Implemented        | covered: `inherited upstream`                    |
| T3-23 | Environment auth, pairing and RPC scopes     | Implemented+tested | covered: `inherited upstream`                    |
| T3-24 | Event-sourced orchestration and SQLite state | Implemented+tested | covered: `inherited upstream`                    |
| T3-25 | Provider adapters and ACP                    | Implemented+tested | covered: `inherited upstream`                    |
| T3-26 | Worktrees and multi-repo projects            | Implemented+tested | covered: `inherited upstream`                    |
| T3-27 | WebSocket RPC transport                      | Implemented+tested | covered: `inherited upstream`                    |

Also retained from upstream: guest links (hidden without Connect), the official-app protocol (version 2, guard
check 1), and the dead T3 Connect code kept for merge hygiene (A15). Upstream additions T3-U01..U03 and
T3-U07..U12 arrive with WI-0.03; T3-U04/U05/U06 wait for open upstream PRs (#34534, #43623, #36693/#27253);
T3-U13 (background self-update from upstream) is excluded unless repointed to the CMDeck feed.

### 3.2 CMDeck improvements (CMX-01..11)

| ID     | Name                                                            | CMDeck status      | Work items / disposition             |
| ------ | --------------------------------------------------------------- | ------------------ | ------------------------------------ |
| CMX-01 | CMDeck identity separate from T3 Code                           | Implemented+tested | covered: `CMDeck fork`               |
| CMX-02 | Shared-data alerts and runtime marker safeguards                | Implemented+tested | covered: `CMDeck fork`               |
| CMX-03 | Opt-in end-to-end encrypted remote control (incl. attachments)  | Implemented+tested | covered: `CMDeck fork`               |
| CMX-04 | Device approval for direct pairing                              | Implemented+tested | covered: `CMDeck fork`               |
| CMX-05 | Desktop auto-update from CMDeck releases with Beta channel      | Implemented+tested | covered: `CMDeck fork`               |
| CMX-06 | Complete uninstall of CMDeck-owned files                        | Implemented+tested | covered: `CMDeck fork`               |
| CMX-07 | Vikunja issue tracker                                           | Implemented+tested | covered: `CMDeck fork`               |
| CMX-08 | LLM Gateway text generator and Gitea gt CLI preference          | Implemented        | WI-0.03; covered: LLM Gateway preset |
| CMX-09 | SQLite cache/mmap with network-drive guard and V8 compile cache | Implemented        | covered: `CMDeck fork`               |
| CMX-10 | Fork guard and upstream sync tooling                            | Implemented        | WI-0.02                              |
| CMX-11 | Settings reorganized (eight destinations) and M3 UI changes     | Implemented        | covered: `CMDeck fork`               |

WI-0.03 replaces the fork's Forgejo `gt`/`tea` variant (CMX-08, M3-35) with upstream's equivalent #42428; the
behaviour is kept. WI-0.02 extends the guard (CMX-10). WI-1.01 moves `ForkAlerts`, `RemoteMcpTokens` and
`PublicAddressCheck` into `ForkLayer` without changing them.

### 3.3 M3-derived functionality

Already in CMDeck (retain) and M3 items the roadmap ports or defers:

| ID    | Name                                                                       | CMDeck status      | Work items / disposition          |
| ----- | -------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| M3-01 | Local-first provider instances and background writing                      | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-02 | Inference server registry                                                  | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-03 | Inference gateway (queues, stats, fallback, cache health, turn affinity)   | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-04 | Runaway-reply watchdog, bounded retries, failure diagnostics               | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-05 | Local model discovery and server repair                                    | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-06 | Image capability checks and vision routing                                 | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-07 | Managed Pi lean MCP tool profile; OpenCode/Codex via gateway               | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-08 | Usage > Local compute; thread last request; mobile read-only inference     | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-09 | Local engine manager (start/stop/update/pull/load/unload/logs)             | Absent             | WI-4.03                           |
| M3-10 | oMLX/Osaurus/Locals engine names and oMLX load                             | Absent             | WI-1.09                           |
| M3-11 | Local-model evals and improvement plan                                     | Absent             | deferred                          |
| M3-12 | Remove telemetry/analytics/OTel/Clerk/Expo OTA/background upstream fetches | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-13 | Provider subprocess telemetry opt-out env                                  | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-14 | Remove Antigravity internal-API quota scraper                              | Removed            | covered: `M3-derived in CMDeck`   |
| M3-15 | Antigravity usage limits via official agy CLI                              | Absent             | deferred                          |
| M3-17 | App-layer E2EE for WebSocket RPC                                           | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-18 | Remote transport policy and connection security badge                      | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-21 | Direct MCP wizard without T3 Connect                                       | Partial            | WI-0.01                           |
| M3-22 | WireGuard/mesh endpoint advertisement                                      | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-24 | CLI release repository points at the fork; fork invariant check            | Implemented        | covered: `cliRelease.ts`; WI-0.05 |
| M3-25 | Add project dialog (machine then folder)                                   | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-26 | Two-tone Dark + OLED theme; opaque glass fast path                         | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-27 | Use monospace font option (web + mobile)                                   | Absent             | deferred                          |
| M3-28 | Default thread environment setting                                         | Absent             | WI-1.10                           |
| M3-29 | SQLite cache/mmap, batched PRAGMAs, parallel probes, V8 cache              | Partial            | covered: `M3-derived in CMDeck`   |
| M3-30 | Non-blocking login-shell probe; skip redundant dev:desktop builds          | Absent             | deferred                          |
| M3-31 | Complete uninstall                                                         | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-32 | Oh My Pi provider                                                          | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-33 | LLM Gateway text-generator preset                                          | Implemented        | covered: `M3-derived in CMDeck`   |
| M3-34 | Vikunja issue tracker                                                      | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-35 | Forgejo/Gitea via gt CLI                                                   | Implemented+tested | covered: `M3-derived in CMDeck`   |
| M3-41 | Pi compaction preserves errors and unfinished work                         | Implemented        | covered: `M3-derived in CMDeck`   |

M3 items deliberately not taken: M3-19 mTLS listener, M3-20 M3 Server control plane, M3-23 SSH runtime upload
(replaced by CLI archives, A11), M3-36 NoName provider, M3-37 plugin host (sandbox ineffective), M3-38 fork
tooling, M3-40 Linux glibc override, M3-42 rebrand. M3-16 and M3-39 are unverified and deferred.

## 4. Verification checklist (brief §12.9)

| Check                                                       | Result                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing T3 functionality is preserved                      | **Pass**                       | §3.1: all 27 inherited primitives are `covered` or extended (T3-01 by WI-1.06, T3-02 by WI-1.05/2.11/2.12/2.13, T3-15 by a WI-1.04 subscriber that leaves `MilestoneHub` untouched). Rules: one-line hooks only (roadmap rule 1), protocol 2 untouched (WI-1.01 acceptance). No WI deletes an upstream feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Existing M3-derived functionality is preserved              | **Pass**                       | §3.3: 24 M3 rows retained (`Existing — retain`); WI-1.09, WI-1.10, WI-4.03 add more. WI-0.03 swaps M3-35's fork `gt` for upstream's identical one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Existing CMDeck improvements are preserved                  | **Pass**                       | §3.2: CMX-01..11 retained; WI-0.02 extends CMX-10. CMD-13..16 and CMD-19 stay `covered` and are chained, not rebuilt (WI-2.20 reuses CMD-14/15/16; WI-1.08 wraps `T3Import.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Every selected Kiro Crew capability is accounted for        | **Pass (73/73)**               | §1: 60 have WIs, 12 are covered by verified existing code or wait on upstream PRs, 1 (AWS-05) is deferred with a reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Every existing CMDeck requirement is accounted for          | **Pass (23/23)**               | §2: 19 have WIs; CMD-03, CMD-06, CMD-13, CMD-14 are covered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AWS functionality remains optional                          | **Pass**                       | D12: no AWS SDK. WI-1.11 is docs plus a provider preset that stores profile names only and has an egress-test row ("no code path reads `~/.aws/*` or calls AWS when no Bedrock instance exists"). WI-3.10 removes ambient `AWS_*` from non-AWS instances (A4). AWS-02..05 native UIs deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Mobile compatibility is addressed                           | **Pass, one open device test** | WI-0.09 device check (resolves the `ba004a8f06`/`8b51f2a348` pairing-retry conflict); WI-3.09 PWA behind Cloudflare Access with a phone-width pass over every fork surface; roadmap rule 8 makes every PR state official-app impact; fork features are ordinary threads or fork tables (ARCHITECTURE_PROPOSAL §12). Official-app push stays unavailable (D8), documented by WI-0.07.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Explicitly excluded functionality is not reintroduced       | **Pass**                       | Roadmap scan for telemetry/analytics/OTLP/tracing, T3 Connect/relay, kanban/board, Jev/TypeSafe/hosted: hits are removals (WI-0.04/0.05/0.06/0.07), a "not a board" rule (WI-2.02), "no hosted endpoint" (WI-2.10) and Kiro telemetry ids refused on import (WI-3.03). One conditional item: under approval A1(a), WI-0.03 keeps upstream's in-process tracing modules **with every exporter deleted**; nothing leaves the machine and WI-0.06 asserts zero egress.                                                                                                                                                                                                                                                                                                                              |
| Newly discovered features are separated from approved scope | **Pass**                       | No WI builds a NEW-* item. NEW-A09 (Web Push) is pending approval A14; WI-1.04 only leaves a channel extension point. WI-4.01's hop limit is a minimum safety rule, not NEW-A02. NEW-C01..C06 (unselected Kiro ideas) stay in NEW_FEATURE_PROPOSALS.md. The one unselected Kiro item built, KCX-10 "Promote incognito to persistent" (WI-2.05), is the reverse state of selected MEM-06 (AGENTS.md "Reverse states"), not a parity feature.                                                                                                                                                                                                                                                                                                                                                      |
| Duplicate implementations are eliminated                    | **Pass**                       | WI scan by subsystem: one workflow engine (all presets in `fork/presets/`, trust table shared by WI-1.06 and WI-2.11), one scheduler lane (WI-1.05 → 2.11 → 2.13 → 2.12; heartbeat is a monitor-loop preset), one notification outbox (alerts, quiet turns and messaging all use WI-1.04), one memory store and one turn-context contributor registry (WI-2.04/2.06/2.15 register into WI-1.07), one importer registry (WI-3.03 and WI-3.04 plug into WI-1.08), one sandbox runner (WI-4.06 implements WI-2.18's interface), one decision service called by WI-2.12/2.16. Spec Builder is folded into the Task Runner preset (DEV-03 → WI-2.01). Name overlap only: CHT-09 "thread notes" (WI-2.15, notes into a thread) and PRD-03 "Notes" (WI-2.09, a markdown folder) are different features. |

## 5. Quality review findings

### 5.1 Path spot-check

Scripted check (`pathcheck.py`, scratchpad) of every backticked repo path in the roadmap and every CMDeck path in
the matrix `source_files`/`tests` columns, plus Glob checks of 30 key paths:

- **Roadmap:** 129 distinct paths. 95 exist. The other 34 are all proposed new files listed under "New:", "New
  files:" or marked **(new)** (e.g. `apps/server/src/fork/memory/*`, `packages/shared/src/redaction.ts`,
  `skills/design-critique/SKILL.md`). One is an M3 source path written without its prefix in WI-4.03's Source
  line (`packages/contracts/src/localEngines.ts`, which exists only in `m3code@6a8f1b0741`); correct in context.
  **No WI cites a non-existent existing-file path.**
- **Matrix:** 355 distinct CMDeck paths; 350 exist. The 5 absent (`apps/server/src/telemetry/`,
  `apps/web/src/observability/`, `apps/mobile/src/features/observability/`, `packages/shared/src/observability.ts`,
  `apps/server/src/provider/antigravityUsageLimits.ts`) are on CMD-01/EXC-01/EXC-03 rows whose status is
  `Removed`; their absence is the finding.
- **Glob, 30 paths, all found:** `ServerSecretStore.ts`, `MilestoneHub.ts`, `ProviderEventIngestor.ts`,
  `ProviderRuntimeRecoveryService.ts`, `ProviderTurnStartService.ts`, `RestartContinuation.ts`,
  `ThreadForkService.ts`, `ThreadManagementService.ts`, `ThreadMessageIntake.ts`, `ThreadSearch.ts`,
  `UsageLimitRecoveryWorker.ts`, `testkit/ThreadMergeBack.integration.test.ts`, `project/AgentSessionImporter.ts`,
  `PullRequestWatchService.ts`, `ElectronSafeStorage.ts`, `preview/PickTarget.ts`, `feedback/scrubFeedback.ts`,
  `process/agentScope.ts`, `scheduledTasks/webhookTemplate.ts`, `ThreadDetailsUsage.tsx`,
  `OpenXmlOfficeViewer.tsx`, `PdfViewer.tsx`, `fileSaveCoordinator.ts`, `_chat.settings.integrations.tsx`,
  `threadNotifications.ts`, `connection/onboarding.test.ts`, `shared/src/AgentScope.ts`, `favicon.ts`,
  `favicon.test.ts`, `skills/t3-workflows/SKILL.md`; plus `QueuedRunOrder.ts`, `AgentSessionScanner.ts`,
  `webhookVerification.ts`, `usagePricing.ts`, `socketE2ee.ts`, `useTimelineRewind.ts`, `ComposerStashMenu.tsx`,
  `packages/tailscale/`, `ServerBrowser.ts`, `SessionControl.ts`.
- **Line references, 14 checked, all match:** `WorkflowRuntime.ts:151` (`import(url)`), `Workflows.test.ts:1061`
  (`workflows.resume(runId)`), `scheduledTask.ts:273` (`ForwardCompatibleArray`), `settings.ts:1585`
  (`workflowsEnabled` default false), `orchestrationV2.ts:3743` (`runtime-request.respond`),
  `claudeResetCredits.ts:216` (`/api/oauth/usage`), `instanceEnvironment.ts:22` (opt-out env skipped when
  `baseEnv` is passed), `UsageService.ts:72-75` (LiteLLM URLs), `cliRelease.ts:6,156` (`pingdotgg/t3code`),
  `triagePrompt.ts:37` (upstream playbook fetch), `tunnel.ts:497` (release base URL), `InferenceServerRegistry.ts:133-139`
  (`ENGINE_BY_OWNER`), `T3Import.ts:541` (hard-wired source/target), `Migrations.ts:389` (`ensureForkSchema()`).

### 5.2 Unsupported or weakly supported claims

These are flagged in the documents themselves; implementers must confirm before relying on them.

1. **"Implemented+tested" means tests exist, not that they pass.** SOURCES.md states no CMDeck tests were run
   during the audit. The 70 `Implemented+tested` rows are source-read claims.
2. WI-2.01: workflow `ask` surfaces as a thread input on the official app **(inferred)**.
3. WI-1.04 / ARCHITECTURE_PROPOSAL §2: projections hold pending runtime requests for start-up reconciliation
   **(inferred)**.
4. WI-0.04: Linux spellcheck dictionary downloads **(inferred from Electron defaults)**.
5. WI-0.08: whether the SSH bootstrap checks archive integrity **(not verified)**.
6. WI-2.17: how the desktop hands the data key to the backend ("mechanism to confirm").
7. WI-1.07 and WI-2.16 hook into **candidate seams** (`ProviderTurnStartService.ts`, `ProviderEventIngestor.ts`)
   found by reading call sites, not by a prototype.
8. BRK-AUTH.08: ambient AWS credentials reach all agents, inferred from `ClaudeDriver.ts:125`.
9. AGT-06 coverage rests on `StepRetry` (a retry-count option, `workflow.ts:239`) and the resume test at
   `Workflows.test.ts:1061`; the test body beyond that line was not re-read in this pass.
10. Licences not checked: `web-push`, `@microsoft/teams.apps` (COMPETITIVE_RESEARCH §8); Kiro app licences and
    `browser-harness` (KIRO_CREW_PORT_ANALYSIS §7) — no Kiro text may be copied until checked.
11. AWS pages not fetched (pricing, IAM action names, AgentCore GA status) per AWS_BEDROCK §8.5.

### 5.3 Contradictions between documents

Fixed in this pass (details in the [Reconciliation log](#reconciliation-log)): duplicate KCX IDs; D3/D4/D5/D6/D8/
D9/D13/D14 roadmap refinements not reflected in the ledger or matrix; 11 matrix actions and 15 effort values disagreeing
with the roadmap; stale CMX numbers (coverage-note numbering) in the roadmap, KIRO_CREW_PORT_ANALYSIS and
COMPETITIVE_RESEARCH; thread map called T3-U11 instead of T3-U05; NEW-C01 claiming merge-back was unverified;
FEATURE_AUDIT counts; ARCHITECTURE_PROPOSAL §1 status counts vs the matrix's `Experimental` relabel; roadmap
WI-0.03 listing T3-U01..U13 as incorporated although U04–U06 are open PRs and U13 is excluded.

Remaining (not fixed, recorded for the lead):

1. **M3-24** has `cmdeck_status` `Implemented` and action `Existing — retain`, but its own description and
   `cliRelease.ts:6` show CMDeck's `t3 update` still targets `pingdotgg/t3code`. The gap is scheduled (WI-0.05);
   the status label overstates it.
2. **Action vocabulary has no "Deferred".** M3-11/15/27/30 keep `M3 available — incorporate or adapt` and AWS-05
   keeps `New — port or implement` although the roadmap defers them; `work_items` carries `deferred`.
3. **BRK-INF.08, BRK-PRM, BRK-AGC** use `Proposed — requires approval` although they are brief §6 requirements,
   not new discoveries; the roadmap treats them as deferred or MCP-covered.
4. **Kiro-derived improvements to existing features are not scheduled:** AUT-05 (no-op PR wakes), INF-04
   (env-marker orphan identity), TLS-01 (input-lock fast-fail, frame password masking). The matrix now says so in
   `recommended_source`; they could become small WIs if wanted.
5. **NEW-C01..C06** exist only in NEW_FEATURE_PROPOSALS.md; the matrix tracks them through their KCX rows
   (`proposed:NEW-Cnn`) rather than as separate rows. Acceptable, but a reader of the matrix alone will not
   see the NEW-C IDs as rows.
6. FEATURE_AUDIT "Status counts" table and research notes keep pre-reconciliation wording in places (research
   notes are raw records; only KCX numbering was rewritten in `research/kirocrew-tools-infra-apps.*`).

## 6. Open questions and blockers (consolidated)

**Approvals that gate scheduled work** ([ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §16): A1 telemetry
fan-out (blocks WI-0.03), A2 workflows default-on with trust gate (WI-1.06 and every preset), A3 site icons
(WI-0.04), A4 strip ambient `AWS_*` (WI-3.10), A5 background inference (WI-2.07, WI-2.10), A6 interpretations of
AUT-03, CHT-07, CHT-09 (also confirm AGT-07, AGT-08, CHT-08 interpretations in the matrix), A7 Teams (WI-4.02),
A8 Kiro transcripts (WI-3.03), A9 engine manager (WI-4.03), A10 sandbox scope (WI-2.18), A11 CLI archives
(WI-0.08), A12 headless key file (WI-2.17), A13 Agent Channels (WI-4.01), A14 Web Push (NEW-A09, not scheduled),
A15 keep dead Connect code. Plus all NEW-A*, NEW-B*, NEW-C* proposals.

**Blockers and verification still owed:**

1. Official mobile app device test (CMD-22, WI-0.09): the pairing-retry conflict is unresolved without a device.
2. PR #23 must merge: the MCP wizard crashes on `main` (WI-0.01).
3. Full typecheck of a merged tree was not possible (read-only audit); other semantic breaks beyond the 8 known
   files may exist (UPSTREAM_SYNC open question 5; WI-0.02 adds the typecheck step).
4. `socketE2ee.ts` replay and downgrade resistance (CMX-03).
5. SSH host-key pinning in `packages/ssh` (CMD-12).
6. Whether HMAC is mandatory in `webhookVerification.ts` (AUT-06).
7. Bedrock: which harness the user drives; Codex-on-Bedrock in scope; live test of the inference gateway
   against `bedrock-mantle`; invoice-accurate attribution; Mantle-only models (AWS_BEDROCK §8).
8. Docker Desktop + WSL2 behaviour of read-only `.git` overlays on Windows (CMD-09).
9. Windows Sandbox usability at all (CMD-10; WI-2.19 decides).
10. Kiro app and `browser-harness` licences; `web-push` and Teams SDK licences.
11. Smaller product questions: keep fork `docs/user/` rewrites or move fork guidance to separate pages
    (UPSTREAM_SYNC Q4); goose as generic ACP or first-class (CMD-11); default embeddings (MEM-07); skill
    creation propose vs auto (MEM-09); NEW-A03 overlap with `t3_pending_request`; KCX-15 overlap with the T3-U05
    thread map; whether merge-back already returns an editable summary (NEW-C01); M3-15 `agy` CLI stability;
    M3-39 Windows payload limit; M3 open PR #19 (local dictation) not assessed; is official-app push required
    (EXC-U06).

## Reconciliation log

All edits are confined to `docs/audit/`. Each fix is the smallest change that removes the contradiction.

| #   | File                                                 | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | KIRO_CREW_PORT_ANALYSIS.md, NEW_FEATURE_PROPOSALS.md | `K1:KCX-nn` → `KCX-nn`, `K2:KCX-nn` → `KCX-Tnn` (matrix IDs); "ID collision to fix" paragraph replaced by a short "Unselected-feature IDs" note; NEW_FEATURE_PROPOSALS intro updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | research/kirocrew-tools-infra-apps.md and .csv       | Own-series `KCX-01..10` renamed `KCX-T01..T10` (the file only references its own series).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | RESEARCH_LEDGER.md                                   | D3, D4, D5, D6, D8, D9, D13, D14 each gained an explicit "**Refined by the roadmap**" paragraph (original text kept): D5 MilestoneHub stays in-memory, notifications get their own outbox; D6 memory items = SQLite rows, Knowledge Library and Notes = files + SQLite index; D8 Web Push = NEW-A09 pending (A14); D4 trust gate before graduation and AGT-06 already covered; D3 per-module `schema.ts`; D9 SageMaker deferred; D13 adapters on the notification service, Teams behind A7; D14 Notes per refined D6. Log entry added.                                                                                                                          |
| 4   | FEATURE_MATRIX.csv                                   | Added 28th column `work_items` for all 260 rows (validated).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | FEATURE_MATRIX.csv                                   | Actions aligned with the roadmap: AGT-06, AUT-05, INF-04, T3-15 → `Existing — retain` (effort `-`); INF-05 `Upstream available` → `Existing — improve` (M, WI-0.03 + WI-2.16); INF-09 `Alternative implementation — evaluate` → `Partial — extend` (L, WI-2.18); MSG-03 `Proposed` → `New — port or implement` (selected; WI-4.02 behind A7); KCX-T07 `New` → `Proposed` (unselected; folded into NEW-B06; was a silent scope expansion); KCX-15, KCX-T06, KCX-T10 `Not selected` → `Proposed` (they are NEW-C04/C05/C06 in NEW_FEATURE_PROPOSALS.md). No matrix row cited verified source the roadmap missed, so no roadmap action was changed on that ground. |
| 6   | FEATURE_MATRIX.csv                                   | Effort aligned with the dedicated WI: AUT-01 S→M, AGT-02 L→M, AGT-10 M→S, CHT-04 M→S, DEV-02 M→L, DEV-06 L→M, CMD-20 M→L, MEM-10 L→M.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7   | FEATURE_MATRIX.csv                                   | D-refinement text: T3-15 description/source/merge note (no MilestoneHub persistence); MEM-10, PRD-03 (files + index); CMD-23 and NEW-A09 (Web Push pending A14); AGT-05 (trust gate, A2); TLS-04, INF-10, MSG-01 (notification service, not MilestoneHub); KCX-05/14/17, NEW-B02, NEW-B06 cross-references to NEW-C*/NEW-A01; AGT-06 and AGT-05 unresolved questions.                                                                                                                                                                                                                                                                                           |
| 8   | IMPLEMENTATION_ROADMAP.md                            | "CMX-01 pattern" → CMD-16; "CI log quotes (CMX-06)" → CMD-15; "mediated secret dispatch (KCX-07)" → KCX-T07 (NEW-B06); pending-approval paragraph now lists NEW-C01..C06, notes NEW-B02 → NEW-A01 and that WI-4.01's hop limit is not NEW-A02; WI-0.03 no longer claims T3-U04..U06 and U13 are incorporated.                                                                                                                                                                                                                                                                                                                                                   |
| 9   | ARCHITECTURE_PROPOSAL.md                             | §1 status counts note the matrix's `Experimental` relabel of AGT-05, AGT-06, AUT-02, INF-01.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10  | FEATURE_AUDIT.md                                     | Action-count table recomputed; redundancy paragraph (22 new, MSG-03 behind A7); conflicts 13 and 17 updated; "These 28 rows" proposal list; messaging and PWA paragraphs follow D5/D8 as refined.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | KIRO_CREW_PORT_ANALYSIS.md                           | Stale coverage-note CMX numbers → CMD-07, CMD-19, CMD-15, CMD-16, CMD-14; MEM-10, AUT-03, INF-10, MSG-01 rows follow D5/D6/D8 as refined; open questions 7–9 marked resolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | NEW_FEATURE_PROPOSALS.md                             | NEW-C04 thread map T3-U11 → T3-U05; NEW-C06 dependency on the notification service; NEW-C01 "duplicates existing" now cites the verified merge-back code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | UPSTREAM_SYNC.md                                     | Thread map row T3-U11 → T3-U05 (matches upstream-sync.csv and FEATURE_AUDIT conflict 14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | COMPETITIVE_RESEARCH.md                              | "Extend CMX-01" → CMD-16; CMD-23 Web Push row and `web-push` dependency marked pending approval (NEW-A09/A14); open check 1 relabelled CMX-03.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 15  | M3_CODE_ANALYSIS.md                                  | Open question 6 marked answered (FEATURE_AUDIT conflict 15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
