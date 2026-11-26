# Research ledger

Working record for the CMDeck source audit (started 2026-11-26). Every research note and
deliverable uses the IDs below. Agents add to the **Log** section; they do not rewrite other
agents' entries.

## Pinned revisions

| Repo                                                            | Ref audited                        | SHA          | Notes                                                                                          |
| --------------------------------------------------------------- | ---------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| [Tehcnological/cmdeck](https://github.com/Tehcnological/cmdeck) | `main` (release `v3`, 3.0.0)       | `4a2f27d590` | MIT                                                                                            |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code)         | `main` (latest release `v0.1.13`)  | `9b4943f91c` | MIT. CMDeck merge base `9ea5044aef` (2026-11-25); upstream 324 commits ahead, CMDeck 339 ahead |
| [MiaAI-Lab/m3code](https://github.com/MiaAI-Lab/m3code)         | `main` (fork 1.1.0)                | `6a8f1b0741` | MIT. Identified from CMDeck README attribution                                                 |
| [kirodotdev/KiroCrew](https://github.com/kirodotdev/KiroCrew)   | `main` (prerelease `v0.14.0-rc.5`) | `b75544f0db` | Apache-2.0 (NOTICE file present). Python                                                       |

Local read-only clones: `%TEMP%/claude/.../scratchpad/repos/{kirocrew,m3code}` (outside the worktree).

## Status vocabulary

Implementation status (per repo): `Implemented+tested`, `Implemented`, `Partial`, `Backend-only`,
`UI-only`, `Experimental`, `Planned`, `Harness-provided`, `Hosted-dependent`, `Removed`, `Absent`,
`Unverified`.

Recommended action: `Existing — retain`, `Existing — improve`, `Upstream available — incorporate`,
`M3 available — incorporate or adapt`, `Partial — extend`, `New — port or implement`,
`Harness-provided — expose or integrate if needed`, `Planned/incomplete — finish existing work`,
`Alternative implementation — evaluate`, `Not selected — do not introduce`,
`Explicitly excluded — remove or avoid`, `Proposed — requires approval`, `Unverified — insufficient evidence`.

Effort: S / M / L / XL (see brief §12.1).

## Feature IDs

### Existing CMDeck requirements (brief §4)

| ID     | Requirement                                                 |
| ------ | ----------------------------------------------------------- |
| CMD-01 | Remove telemetry, analytics, unnecessary outbound requests  |
| CMD-02 | Remove T3 Connect dependencies, keep remote functionality   |
| CMD-03 | Tailscale private connectivity between environments         |
| CMD-04 | Cloudflare Tunnel + Cloudflare Access remote web access     |
| CMD-05 | Self-hosted orchestration MCP server reachable over tailnet |
| CMD-06 | No mandatory CMDeck-operated cloud service / paid infra     |
| CMD-07 | Local model providers: Ollama, LM Studio, llama.cpp         |
| CMD-08 | Windows/macOS/Linux execution environments                  |
| CMD-09 | Per-thread Docker sandboxing                                |
| CMD-10 | Windows Sandbox integration                                 |
| CMD-11 | Alternative harnesses: OpenCode, goose, ACP agents          |
| CMD-12 | Remote execution on user-owned machines                     |
| CMD-13 | Background execution and close-to-tray                      |
| CMD-14 | Batched diff comments                                       |
| CMD-15 | CI failures + logs fed back to agents                       |
| CMD-16 | Independent second-model code review                        |
| CMD-17 | Preserve Git, worktree, PR functionality                    |
| CMD-18 | Preserve upstream workflow/orchestration capabilities       |
| CMD-19 | T3 Code migration utility                                   |
| CMD-20 | Kiro Crew data import via same migration framework          |
| CMD-21 | Import from other agent environments (evaluate)             |
| CMD-22 | Official T3 mobile app compatibility                        |
| CMD-23 | Responsive CMDeck PWA via Cloudflare Tunnel/Access          |

### Selected Kiro Crew features (brief §5)

| ID     | Feature                          | ID     | Feature                         |
| ------ | -------------------------------- | ------ | ------------------------------- |
| AGT-01 | Task Runner                      | MEM-01 | Persistent memory               |
| AGT-02 | Persistent Bots                  | MEM-02 | Editable memory                 |
| AGT-03 | Conductor mode                   | MEM-03 | Self-learning                   |
| AGT-04 | Parallel subagents               | MEM-04 | Repository-scoped lessons       |
| AGT-05 | Dynamic Workflows                | MEM-05 | Private bot memory              |
| AGT-06 | Selective workflow retry         | MEM-06 | Incognito / temporary memory    |
| AGT-07 | Work Ledger                      | MEM-07 | Semantic memory search          |
| AGT-08 | Session Ledger                   | MEM-08 | Memory decay                    |
| AGT-09 | Agent Channels                   | MEM-09 | Automatic skill creation        |
| AGT-10 | Research Lab                     | MEM-10 | Knowledge Library               |
| AUT-01 | Cron jobs                        | CHT-01 | Session search                  |
| AUT-02 | Deterministic scheduled scripts  | CHT-02 | Session forking                 |
| AUT-03 | Heartbeat monitoring             | CHT-03 | Cross-session control           |
| AUT-04 | Monitor Loops                    | CHT-04 | Split-view conversations        |
| AUT-05 | PR monitoring                    | CHT-05 | Editable queued messages        |
| AUT-06 | Inbound webhooks                 | CHT-06 | Message quoting and pinning     |
| AUT-07 | Automatic quota recovery         | CHT-07 | Context breakdown               |
| TLS-01 | Live browser with human takeover | CHT-08 | Quiet-turn indicator            |
| TLS-02 | Computer Use                     | CHT-09 | Session notes                   |
| TLS-03 | Markdown skills                  | INF-01 | Remote Crew                     |
| TLS-04 | Lifecycle hooks                  | INF-02 | Headless gateway                |
| TLS-05 | Jev model routing                | INF-03 | Snapshot and restore            |
| TLS-06 | Jev context selection            | INF-04 | Crash and orphan recovery       |
| TLS-07 | Jev wake decisions               | INF-05 | Independent permission policies |
| TLS-08 | Jev risk flagging                | INF-06 | Encrypted secrets vault         |
| DEV-01 | Code Review Sage                 | INF-07 | Credential redaction            |
| DEV-02 | Auto-Improvement                 | INF-08 | Chained security audit log      |
| DEV-03 | Spec Builder                     | INF-09 | OS sandboxing                   |
| DEV-04 | Design Tweak                     | INF-10 | Usage limits and alerts         |
| DEV-05 | Design Critique                  | INF-11 | Alternative harnesses and ACP   |
| DEV-06 | Ops Mission Control              | INF-12 | Agent onboarding importer       |
| AWS-01 | AWS Control                      | PRD-01 | Papyrus                         |
| AWS-02 | S3 cloud drive                   | PRD-02 | PPTX Maker                      |
| AWS-03 | EC2 launcher                     | PRD-03 | Notes                           |
| AWS-04 | AWS artifact deployment          | MSG-01 | Slack                           |
| AWS-05 | SageMaker decision models        | MSG-02 | Telegram                        |
|        |                                  | MSG-03 | Microsoft Teams                 |

### AWS / Bedrock extended requirements (brief §6)

| ID       | Area                                       | ID        | Area                              |
| -------- | ------------------------------------------ | --------- | --------------------------------- |
| BRK-AUTH | Auth & accounts (§6.1)                     | BRK-KB    | Knowledge Bases & RAG (§6.4)      |
| BRK-INF  | Bedrock models & inference (§6.2)          | BRK-AGC   | Bedrock Agents & AgentCore (§6.5) |
| BRK-PRM  | Prompt dev & evaluation, Guardrails (§6.3) | BRK-INFRA | AWS infrastructure (§6.6)         |
| BRK-COST | Costs & quotas (§6.7)                      |           |                                   |

Sub-items get a suffix, e.g. `BRK-INF.03` for inference profiles.

### Other prefixes (assigned by the owning agent)

- `T3-NN` — upstream T3 Code capability worth recording (inherited or new upstream). Owner: CMDeck + upstream agents.
- `CMX-NN` — CMDeck-only addition not in the brief's list (e.g. E2EE remote control). Owner: CMDeck agent.
- `M3-NN` — M3 Code capability. Owner: M3 agent.
- `KCX-NN` — unselected Kiro Crew feature (recorded only when T3/CMDeck already has an equivalent, or for exclusion). Owner: Kiro agents.
- `NEW-NN` — genuinely new proposal from competitive research. Owner: competitive agents. Never roadmap scope without approval.
- `EXC-NN` — explicitly excluded (telemetry, T3 Connect, kanban/boards, phone-home).

## Evidence rules

- Cite `repo@sha:path:line` or `path` + symbol for every implementation claim. Mark anything
  not read in source as **(inferred)** or **(docs-only)**.
- Never fabricate files, symbols, tests, or PR numbers. If something is not found, say "not found
  after searching X".
- Research notes live in `research/`. Deliverables reference them by feature ID.

## Lead decisions (synthesis baseline)

These are recommendations drawn from the research notes. The roadmap builds on them. Items marked
**[needs approval]** are choices for the user, not settled facts.

- **D1 Sync before building.** Merge upstream at the `v0.1.13` tag first. Add a typecheck step and an
  `ensureForkSchema`-present check to `scripts/fork/sync-upstream.sh`/`guard.sh`. After that, sync at
  every upstream stable tag (≤ weekly). Drop fork patches upstream now matches (Antigravity probing,
  Antigravity identity, Forgejo `gt`). ([UPSTREAM_SYNC.md](UPSTREAM_SYNC.md))
- **D2 Telemetry fan-out [needs approval].** Keep upstream's in-process tracing modules but delete
  every exporter/sink, so 64 upstream importers merge cleanly and nothing leaves the machine. The
  alternative is keeping everything deleted plus a no-op shim. Product analytics (`AnalyticsService`)
  stays deleted either way.
- **D3 Fork isolation.** New subsystems go in `apps/server/src/fork/<module>/`, with tables in
  `ForkSchema.ts` (never numbered migrations), additive contracts in a fork contracts module, fork
  RPCs registered from one fork file instead of growing `ws.ts`/`rpc.ts`, and the protocol version
  untouched.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** `ensureForkSchema` stays the single entry, but each fork module owns a `schema.ts` with an idempotent `ensure*Schema()` called one line each from `ForkSchema.ts` (WI-1.01 and every module WI).
- **D4 One workflow engine.** The existing `effect/workflow` engine (`apps/server/src/workflows`)
  hosts Task Runner, Research Lab, Conductor, Spec Builder, Code Review Sage, Auto-Improvement and
  Ops Mission Control as presets/templates. Workflows graduate from Labs. No second runtime.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** graduation is gated on a **workflow file trust gate** (new or changed workflow files load only after the user approves their SHA-256; WI-1.06, approval A2), because `WorkflowRuntime.ts:151` imports workflow files in-process. AGT-06 selective retry is **already covered** (failed-step resume, `workflow.ts` `StepRetry`, `Workflows.test.ts:1061`); retry from an arbitrary earlier step is deferred and proposed upstream.
- **D5 One scheduler, one event bus.** `scheduledTasks` gains cron expressions, a check-script gate
  and an agent self-schedule (heartbeat) tool. `MilestoneHub` gains persistence and becomes the
  single source for notifications, messaging, webhooks out, and alerts.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** **`MilestoneHub` is not modified and stays in-memory** (its contract says milestones are derived and kept only in memory, `packages/contracts/src/milestones.ts`). A fork notification service (WI-1.04) subscribes to it and keeps its **own delivery outbox** table; fork-only alerts call that service directly. Messaging, alerts and outbound delivery hang off the notification service, not off MilestoneHub.
- **D6 One memory system.** A fork module on SQLite with scoped `memory_items`, a revisions table
  and FTS5. Agent-inferred items arrive as pending proposals. Optional local embeddings go through
  the existing local-inference gateway. No vector or graph DB. Exposed through MCP tools plus
  provider instruction materialization. Knowledge Library and Notes are document-type items in the
  same store.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** short **memory items** (facts, rules, lessons, state cards) are SQLite rows (WI-1.07). **Knowledge Library sources and Notes are files on disk** with a SQLite chunk index (FTS5, optional vectors) beside the memory tables (WI-2.09); notes are a markdown folder edited in the existing file editor. This also settles the conflict with competitive-libraries' "files as source of truth for documents".
- **D7 Bots are threads.** A bot is a persistent thread plus a bot profile (identity, private memory
  scope, schedule, channel bindings), not a separate runtime. The official mobile app sees ordinary
  threads.
- **D8 Notifications.** Self-hosted Web Push (VAPID) with a service worker for the PWA. Official
  mobile app push needs T3's hosted relay; accept that limitation and document it.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** **Web Push is not scheduled.** It is proposal **NEW-A09**, pending approval (A14). The notification service (WI-1.04) is channel-neutral (in-app and messaging first) and leaves an extension point for Web Push. The official-app push limitation stands (WI-0.07 docs).
- **D9 Decision service.** It replaces Jev's four functions. Deterministic rules come first, with
  an optional local model via the inference gateway. It is never a security boundary and never
  calls a hosted Jev/TypeSafe API.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** the SageMaker provider (AWS-05) is deferred; rules-only and local-model providers ship first (WI-2.10).
- **D10 Security.** Policy enforcement stays in the existing TypeScript permission layer (no OPA).
  Encrypt secrets at rest with an OS-keychain-held key (desktop) and a documented file-key fallback
  (headless). Redaction is on by default for logs, exports and outbound messages. Add a local
  hash-chained audit log.
- **D11 Sandboxing.** Per-thread Docker uses a container recipe modeled on Agent of Empires' mount
  table, with network `none`/allowlist and label-based reaping. Windows Sandbox is feasibility-first.
  Container limits are stated honestly. Watch upstream #15350.
- **D12 AWS.** No AWS SDK in the first phases. Ship Bedrock docs, a provider preset, per-instance
  `AWS_*` env scoping, and AWS MCP server guidance. Native Bedrock/AgentCore UI is deferred. Inert
  by construction.
- **D13 Messaging.** One adapter interface on MilestoneHub plus approvals. Telegram (grammy) and
  Slack (bolt, Socket Mode) first. Teams **[needs approval]** (public endpoint plus Azure bot
  registration).
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** adapters hang off the notification service outbox (see D5), not MilestoneHub. Teams is scheduled last (WI-4.02) behind approval A7.
- **D14 Productivity.** Reuse html-renders/attachments as the artifact layer. Notes live in the
  knowledge store (D6). Papyrus/PPTX become skills plus sandboxed compile. No editors.
  **Refined by the roadmap (2026-11-26, [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §2):** Notes follow D6 as refined (files plus index, WI-2.09), not memory-store documents. Papyrus is a LaTeX compile action and PPTX a skill guide (WI-3.08).
- **D15 Wait for upstream.** Do not rebuild computer use (#16530), usage limits/breakdowns
  (#39893, #29931), OpenCode import (#41296), automation fallback models (#43605), moving threads
  between machines (#41771) or host extensions (#34534). Re-check them at each sync.
- **D16 One importer framework.** Generalize `cmdeck import-from-t3` into `cmdeck import <source>`.
  Kiro Crew input is its portability export zip, mapping records the way upstream's
  `LegacyV1ThreadImporter` does.

## Approvals (2026-11-26)

The user answered approvals A1–A15 ([ARCHITECTURE_PROPOSAL.md §16](ARCHITECTURE_PROPOSAL.md#16-decisions-requiring-approval)).
These answers override the lead decisions and refinements above where they differ.

- **A1** Keep upstream's in-process tracing modules and delete every exporter and sink (refines D2).
- **A2** Workflows on by default behind the file trust gate.
- **A3** Link icons off by default. The opt-in fetches each site's own icon; Google and DuckDuckGo icon
  services were both rejected because a middleman sees every linked hostname.
- **A4** Strip inherited `AWS_*` credentials from instances that do not declare them.
- **A5** Background inference uses local models by default, with per-project opt-in to the thread's provider.
- **A6** AUT-03 Heartbeat = health monitoring (sessions alive, environments reachable, user probes), alerting
  on failure and recovery. CHT-09 Session notes **dropped**: the user considers it covered by queued messages
  and thread send. CHT-07 Context breakdown as proposed (honest partial).
- **A7** Teams not now.
- **A8** Kiro transcripts always imported, as read-only archived threads.
- **A9** M3 engine manager: management panel, start/stop/pull and install instructions; never runs installers.
- **A10** Sandboxes: Docker on all OSes, Apple `container` on macOS, Windows Sandbox (spike then backend); no
  Seatbelt (it duplicates harness sandboxes and confuses users). Internet off by default (refines D11).
- **A11** Publish CLI archives in CMDeck releases.
- **A12** Headless secrets key: TPM-sealed via `systemd-creds` when available, else a same-user key file (refines D10).
- **A13** Agent Channels later, after Conductor.
- **A14** Web Push approved. NEW-A09 moves into scope as WI-3.11 (refines D8).
- **A15** Keep dormant T3 Connect code.

## Log

<!-- Append: `- YYYY-MM-DD [agent] completed/remaining/question/decision/conflict — text (confidence)` -->

- 2026-11-26 [lead] Pinned revisions above; identified M3 Code as MiaAI-Lab/m3code from README attribution and commit history (`2615f5e5a0`, `5631bbe949`, PRs #11/#14/#15).
- 2026-11-26 [lead] completed — 9 research agents (CMDeck fork, wishlist coverage, upstream sync, M3, Kiro ×2, AWS, competitive ADEs, competitive libraries), 3 synthesis agents (matrix, summaries, architecture+roadmap) and 1 coverage/reconciliation pass. Executive summary in [README.md](README.md). Lead fixed M3-24 cmdeck_status Implemented → Partial (`packages/shared/src/cliRelease.ts:6` still `pingdotgg/t3code`).
- 2026-11-26 [lead] decision — user answered A1–A15 (see Approvals). Roadmap now has 59 WIs: WI-3.11 Web Push added, WI-2.15 reduced to pins, and WI-2.12, 2.17, 2.18, 3.03 and 4.03 rescoped. Corrected `web-push` license to MPL-2.0 (`npm view`).
- 2026-11-26 [lead] decision — audit lives in `docs/audit/` at the user's explicit request (AGENTS.md normally keeps plans out of the repo; the brief overrides that for these deliverables).

<!-- Merged by the synthesis agent from the "Ledger entries" section of each research note; deduplicated; source agent in brackets. -->

- 2026-11-26 [cmdeck] completed — Fork inventory at 4a2f27d590: 339 commits over 9ea5044aef (M3 history ~140, PR #1 squash, PRs #6–#22); guard.sh passes; see research/cmdeck-fork.md (high)
- 2026-11-26 [cmdeck] completed — CMD-01..23 verified: 7 Implemented+tested, 6 Implemented, 6 Partial, 4 Absent (CMD-09, CMD-10, CMD-20, CMD-21) (high). Synthesis later reclassified CMD-21 as Partial (see Conflicts).
- 2026-11-26 [cmdeck] completed — Telemetry code removed, not stubbed; remaining no-opt-in egress: desktop update poll (no UI toggle), model manifest + provider version checks (one toggle), Claude oauth/usage poll, Google s2 favicons for every linked host, git fetch every 30 s (high)
- 2026-11-26 [cmdeck] conflict — ba004a8f06 says official mobile cannot retry pending pairing; 8b51f2a348 says it can (client-runtime test agrees with the latter); needs a device test (medium)
- 2026-11-26 [cmdeck] completed — M3 SSH runtime upload (8a6e96e5d4) absent at HEAD; releases ship no CLI archives, so SSH remote/headless installs need a T3CODE_RELEASE_BASE_URL mirror (high)
- 2026-11-26 [cmdeck, m3] remaining — PR #23 open: the MCP wizard (M3-21 port) crashes on main with Clerk useAuth until merged (high)
- 2026-11-26 [cmdeck] decision-proposal — Kiro Crew importer should reuse T3Import's plan/dry-run/CLI/offer shell but map records like LegacyV1ThreadImporter, not copy files (medium, inferred)
- 2026-11-26 [cmdeck] completed — Merge burden: 240 fork-modified files also changed upstream; 12 modify/delete conflicts expected on next sync (high)
- 2026-11-26 [cmdeck, m3] question — packages/shared/src/cliRelease.ts:6 still names pingdotgg/t3code (used by t3 update); retarget or remove? Synthesis verified the line (medium)
- 2026-11-26 [coverage] completed — Inherited upstream primitives T3-01..T3-27 verified in source and mapped to the 73 selected Kiro IDs; see research/cmdeck-wishlist-coverage.md (high)
- 2026-11-26 [coverage] conflict — coverage note assigned CMX-01..08 to fork additions; the CMDeck agent owns CMX and numbered them differently. CMDeck numbering kept (medium)
- 2026-11-26 [coverage] question — workflows (AGT-05/06, AUT-02) and linked environments (INF-01) are Labs-gated; accept graduating them? (high)
- 2026-11-26 [upstream] completed — upstream/main `9b4943f91c`, 324 commits past base `9ea5044aef` (302 fix / 8 feat), v0.1.13 `bc0f04da94`; merge-tree predicts 119 conflicts (51 docs, 20 i18n, 11 modify/delete telemetry) plus 8 clean-merge compile breaks from #43209 (high)
- 2026-11-26 [upstream] completed — protocol version unchanged (2); one new migration 119 (workflow run subject), not identity-bound; T3Import needs no new exclusions (high)
- 2026-11-26 [upstream] conflict — guard does not protect the `ensureForkSchema` hook in `Migrations.ts`; the sync doc says to take that file exactly (high)
- 2026-11-26 [upstream] decision needed — keep upstream local-only tracing (drop only exporters) vs inert stub, to cut the 64-file telemetry fan-out (medium)
- 2026-11-26 [upstream] completed — official mobile app pairs over LAN/Tailscale without Connect; push/Live Activities require the T3 relay (high)
- 2026-11-26 [upstream] IDs assigned — T3-U01…T3-U13, EXC-U01…EXC-U06 (see research/upstream-sync.csv)
- 2026-11-26 [m3] completed — Inventoried m3code@6a8f1b0741 (fork 1.1.0; merge base `5d02075446`; +232/−518 vs t3/main `9b4943f91c`); 42 capabilities M3-01…M3-42 in research/m3code.csv and M3_CODE_ANALYSIS.md (high)
- 2026-11-26 [m3] completed — License MIT, copyright lines verified; CMDeck LICENSE + README attribution sufficient for ported code (high)
- 2026-11-26 [m3] decision — M3 plugin host is not a suitable module-isolation mechanism for AWS/messaging; sandbox ineffective (`allow-scripts allow-same-origin`, same origin), sidecars inherit env, bridge commands are no-ops. Recommend optional workspace packages instead (high)
- 2026-11-26 [m3] completed — CMD-07: M3-09 local engine manager and M3-10 MLX names are the only significant M3 local-inference pieces CMDeck lacks (high)
- 2026-11-26 [m3] question — M3 batched PRAGMAs likely leave `foreign_keys` off in M3 (CMDeck PR #14 analysis; not executed) (medium)
- 2026-11-26 [m3] remaining — No M3 implementation for AGT-_, MEM-_, AUT-_, TLS-_, CMD-09, CMD-10, INF-09, CMD-23 (PWA beyond icons) (high)
- 2026-11-26 [kiro-1] completed — AGT-01..10, MEM-01..10, AUT-01..07 and CHT-01..09 audited at `kirocrew@b75544f0db`; data-store map and telemetry findings in research/kirocrew-agents-memory-automation-chat.md (medium-high)
- 2026-11-26 [kiro-1] decision (proposed) — Task Runner, Conductor and Research Lab become presets on one workflow engine. AGT-05 must not execute model-authored code; use a declarative DAG (high)
- 2026-11-26 [kiro-1] decision (proposed) — one `memory_items`-style SQLite table with a `scope` column, a revisions table and FTS5; embeddings opt-in via local providers; poisoning gates on by default (Kiro ships them off) (high)
- 2026-11-26 [kiro-1] conflict — Kiro "Heartbeat" is a HEARTBEAT.md task queue plus maintenance, not health monitoring; AUT-03 meaning needs a decision (high)
- 2026-11-26 [kiro-1] conflict — Kiro "Session notes" is "note injected into a chat without a turn", not a notes document; CHT-09 meaning needs a decision (high)
- 2026-11-26 [kiro-1] question — CMDeck equivalents for AUT/CHT items were found by keyword only; CMDeck agent to confirm "Existing — improve" (answered by the coverage note; see Conflicts)
- 2026-11-26 [kiro-1, kiro-tools] exclusion — Kiro ships default-on product metrics to telemetry.us-east-1.kiro.dev and a daily CloudFront beacon; CDN model/video downloads and update checks are default-on (KCX-03, KCX-04; high)
- 2026-11-26 [kiro-tools] completed — TLS/INF/DEV/AWS/PRD/MSG audited at `kirocrew@b75544f0db`; see research/kirocrew-tools-infra-apps.md (high)
- 2026-11-26 [kiro-tools, competitive-libraries] decision (proposed) — Jev (TLS-05..08) is TypeSafe's hosted decision model by default in Kiro; replace with one local-first DecisionService; hosted default is excluded (medium)
- 2026-11-26 [kiro-tools] finding — Kiro has no Windows OS sandbox; INF-09 does not satisfy CMD-09/10 (high)
- 2026-11-26 [kiro-tools] conflict — TLS-01 overlaps CMDeck's existing Playwright preview (`ServerBrowser.ts`); CMDeck agent to confirm takeover (answered by the coverage note: implemented and tested) (medium)
- 2026-11-26 [kiro-tools] IDs assigned — BRK-INF.01, BRK-KB.01, BRK-AUTH.01, BRK-COST.01, BRK-INFRA.01; KCX-01..10 (renumbered KCX-T01..T10 in synthesis because kiro-1 already used KCX-01..17)
- 2026-11-26 [aws-bedrock] completed — BRK-INF.01/.06/.07/.11/.12/.13: Implemented via Claude Code env vars (`ClaudeProvider.ts:207-231`, `ClaudeCodeModelRoutes.ts:16-22`, tests). Action: Existing — improve (docs) (high)
- 2026-11-26 [aws-bedrock] completed — BRK-AUTH.01-.06, .09: Harness-provided (Claude Code/OpenCode credential chain, SSO, `awsAuthRefresh`); CMDeck supplies per-instance env + secret refs (high)
- 2026-11-26 [aws-bedrock] finding — BRK-AUTH.08: provider env inherits server `process.env`, so ambient AWS creds reach all agents (inferred from `ClaudeDriver.ts:125`); decision needed (medium)
- 2026-11-26 [aws-bedrock] completed — BRK-COST.01-.03: Partial (token-based estimates in `usagePricing.ts`); invoice-accurate attribution needs application inference profiles or IAM principal attribution (medium)
- 2026-11-26 [aws-bedrock] decision-proposed — AWS-01/02/04, BRK-KB._, BRK-PRM._, BRK-COST.04/.07/.09 through AWS MCP Server + awslabs MCP servers + Agent Toolkit skills; no native UI (high)
- 2026-11-26 [aws-bedrock] completed — BRK-AGC.01: classic Bedrock Agents closed to new sign-ups; not selected (high)
- 2026-11-26 [aws-bedrock] completed — BRK-AGC.02-.09, AWS-03, AWS-05, BRK-INF.08: available in AWS but defer (synthesis kept the deferral but re-labelled selected AWS-03/AWS-05; see Conflicts) (high)
- 2026-11-26 [aws-bedrock] question — Codex Bedrock login: CMDeck has schema types but no UI. Is Codex-on-Bedrock in scope? (high)
- 2026-11-26 [aws-bedrock] unverified — CMDeck inference gateway against `bedrock-mantle` with a Bedrock API key needs a live test (low)
- 2026-11-26 [competitive-ades] completed — Stage 1 for all 20 §7.1 projects; deep dives for Paseo, OpenChamber, Orca, Agent Orchestrator, Emdash, Jean, Nimbalyst, Agent of Empires, Podium, Frink, Sillage; lead read of PandaCode, Vigla, Sculptor; see research/competitive-ades.md (high)
- 2026-11-26 [competitive-ades] decision — "Podium ADE" = madeinorbit/podium; "Agent Orchestrator" = OrchestratorInc/agent-orchestrator (private ao-cloud submodule out of scope) (high)
- 2026-11-26 [competitive-ades] licence — Alethe AGPL-3.0 (reference only); PandaCode custom MIT+attribution; Paseo Apache-2.0 with third-party carve-out; Podium Apache-2.0 + NOTICE (high)
- 2026-11-26 [competitive-ades] completed — CMD-09 reference spec: AoE create_args mount table + AO dockerreap labels + Nimbalyst egress allowlist. CMD-10: no reference found (high)
- 2026-11-26 [competitive-ades] question — Does packages/shared/src/socketE2ee.ts reject replays and pin against downgrade like Paseo's relay? (open)
- 2026-11-26 [competitive-ades] conflict — PandaCode account pools are an AUT-07 alternative, but rotating accounts to bypass limits is a likely provider-terms violation; recommend against (medium)
- 2026-11-26 [competitive-libraries] completed — §7.2–7.5/7.7 library research; 33 repos + 2 follow-ons verified (renames recorded in SOURCES.md); see research/competitive-libraries.md (high)
- 2026-11-26 [competitive-libraries] decision — no durable-execution dependency: CMDeck workflows already run on effect/workflow with journaled steps, durable waits and failed-step-only resume (workflows/workflow.ts:15,188-200; Migrations/110_Workflows.ts) (high)
- 2026-11-26 [competitive-libraries] decision — memory = Markdown/SQLite FTS5 (migration 069) + optional local embeddings; no vector/graph DB; provenance stored outside content; untrusted writes staged, fail-closed (high)
- 2026-11-26 [competitive-libraries] decision — adopt grammy + @slack/bolt for MSG-02/01 (TS, MIT, no inbound port); Teams needs tunnel ingress (medium)
- 2026-11-26 [competitive-libraries] conflict — licence: screenpipe now commercial source-available; litellm/langfuse/tabby mixed (enterprise dirs). Telemetry on by default: mem0, graphiti, cognee, browser-use, promptfoo, ccusage, crewAI, OpenShell (high)
- 2026-11-26 [competitive-ades, competitive-libraries] proposed — NEW-A01..A13 and NEW-B01..B06 recorded; require approval, not roadmap scope
- 2026-11-26 [synthesis] completed — FEATURE_MATRIX.csv (260 rows, 27 columns, unique IDs, script-validated) and FEATURE_AUDIT.md written from all nine research CSVs and notes (high)
- 2026-11-26 [synthesis] summary:
  - **Completed investigations.** CMDeck fork (CMD-01..23, CMX-01..11, EXC-01..06); wishlist coverage (73 selected Kiro IDs, T3-01..27); upstream sync (T3-U01..13, EXC-U01..06); M3 Code (M3-01..42); Kiro Crew agents/memory/automation/chat and tools/infra/apps (KCX-01..17, KCX-T01..T10); AWS/Bedrock (BRK areas); competing ADEs (NEW-A01..A13) and libraries (NEW-B01..B06). 28 of 73 selected wishlist items are already in CMDeck or harness-provided.
  - **Remaining.** Device test of the official mobile app (CMD-22, pairing-retry conflict); socketE2ee replay/downgrade review (CMX-03); SSH host-key pinning (CMD-12); HMAC-mandatory check in webhookVerification.ts (AUT-06); live test of the inference gateway against bedrock-mantle (BRK-INF); KCX-15 session-summary overlap with T3; M3-16 Antigravity update wiring; M3-39 Windows payload limit; full typecheck of a merged tree (UPSTREAM_SYNC open question 5); decisions D2, D13 (Teams) and the ambiguous-name interpretations for AGT-07/08/09, AUT-03, CHT-08/09.
  - **Conflicts resolved in synthesis.** (1) CMX numbering: CMDeck note owns CMX; coverage CMX-01..08 mapped to CMD-16, CMX-03, CMD-07, CMD-19, CMD-14, CMD-15, CMD-05/04, CMD-13; competitive-ades "CMX-05" and T3-27 "CMX-02" corrected. (2) KCX collision: kiro-tools IDs renumbered KCX-T01..T10; KCX-T03 = KCX-03; KCX-11 = INF-12. (3) CMD-21 Absent → Partial (inherited AgentSessionImporter verified, agentSessions.ts:5). (4) Kiro keyword guesses for AUT/CHT → coverage verification wins; CHT-04 Partial. (5) KCX-05 merge-back, KCX-06 rewind, KCX-09 stash already exist (verified). (6) kiro-tools actions for INF-03/04/12, TLS-04, DEV-04 adjusted to verified CMDeck status. (7) Labs-gated features recorded as Experimental. (8) AWS-03/05 kept selected (Harness-provided / New, deferred) instead of Proposed. (9) T3-U05 = thread map (UPSTREAM_SYNC.md table said T3-U11). (10) M3 question on manifest/LiteLLM fetches answered: manifest from CMDeck repo, LiteLLM only when Usage opens. (11) Jev confirmed hosted TypeSafe default; excluded. Unresolved: mobile pairing retry (needs device).
- 2026-11-26 [coverage-verification] completed — Brief §12.9 + §14 step 13: FEATURE_COVERAGE.md written; 73/73 selected Kiro IDs and 23/23 CMD requirements mapped (matrix `work_items`, 28th column, script-validated); all 58 WIs referenced. Lead decisions D3/D4/D5/D6/D8/D9/D13/D14 annotated with the roadmap's refinements; KCX labels unified to KCX-NN / KCX-TNN; 11 matrix actions and 15 efforts aligned with the roadmap (list in FEATURE_COVERAGE.md "Reconciliation log") (high)
- 2026-11-26 [coverage-verification] conflict (open) — M3-24 is labelled Implemented/Existing — retain but `cliRelease.ts:6` still targets pingdotgg/t3code; fixed by WI-0.05, label left as is (high)
