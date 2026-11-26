# CMDeck source audit and roadmap (2026-11-26)

This folder holds a source audit of CMDeck, upstream T3 Code, M3 Code and Kiro Crew, plus targeted
research into about 60 other open-source projects, and the implementation roadmap built from it. It is a
**planning record**. No application code was changed. Implementation waits for the roadmap and the
approvals listed below.

Pinned revisions: CMDeck `4a2f27d590` (v3), T3 Code `9b4943f91c` (v0.1.13), M3 Code `6a8f1b0741`, Kiro
Crew `b75544f0db` (v0.14.0-rc.5). See [SOURCES.md](SOURCES.md).

## Documents

| File                                                     | What it answers                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [FEATURE_MATRIX.csv](FEATURE_MATRIX.csv)                 | **Canonical inventory.** 260 features × 28 columns: status in each repo, action, effort, risks, and the covering work items |
| [FEATURE_AUDIT.md](FEATURE_AUDIT.md)                     | Findings by category: what exists, what is partial, what is missing, conflicts between sources                              |
| [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md)                     | Divergence from T3, the 324 upstream commits, predicted conflicts, and the sync strategy                                    |
| [M3_CODE_ANALYSIS.md](M3_CODE_ANALYSIS.md)               | What CMDeck already took from M3, what is still worth taking, and what to avoid                                             |
| [KIRO_CREW_PORT_ANALYSIS.md](KIRO_CREW_PORT_ANALYSIS.md) | How Kiro Crew implements each selected feature, and port/adapt/native decisions                                             |
| [AWS_BEDROCK.md](AWS_BEDROCK.md)                         | Brief §6 checked against current AWS docs, plus the minimal optional AWS plan                                               |
| [COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md)       | Licenses, maintenance, and the best implementation per gap across the other projects                                        |
| [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md)     | The recommended architecture: retain, extend, consolidate, and the few new fork modules                                     |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)   | 59 work items in 5 phases, with parallelization, top 10, quick wins and deferrals                                           |
| [FEATURE_COVERAGE.md](FEATURE_COVERAGE.md)               | Every requirement mapped to the roadmap, the §12.9 checklist, quality review and blockers                                   |
| [NEW_FEATURE_PROPOSALS.md](NEW_FEATURE_PROPOSALS.md)     | 24 discoveries outside the wishlist. **None are approved scope**                                                            |
| [RESEARCH_LEDGER.md](RESEARCH_LEDGER.md)                 | IDs, vocabulary, lead decisions (with refinements), and the research log                                                    |
| [research/](research/)                                   | Evidence notes and CSV fragments from each research agent                                                                   |

IDs: `CMD-*` existing CMDeck requirements, `AGT/MEM/AUT/CHT/TLS/INF/DEV/AWS/PRD/MSG-*` selected Kiro Crew
features, `BRK-*` Bedrock areas, `T3-*`/`T3-U*` upstream, `CMX-*` fork additions, `M3-*`, `KCX-*` unselected
Kiro features, `EXC-*` exclusions, `NEW-*` proposals, and `WI-<phase>.<nn>` work items.

## Executive summary

### What CMDeck already has

CMDeck v3 is T3 Code at merge base `9ea5044aef` plus 339 fork commits. The fork commits fall into these groups:

- privacy work: analytics, crash reporting and OTLP export are deleted outright, and `scripts/fork/guard.sh` keeps them out;
- T3 Connect disabled at the boundary;
- a separate identity (`~/.cmdeck`, port 3783);
- end-to-end encrypted remote control and the M3 local-inference stack (CMD-07);
- a T3 data importer, second-model review, batched diff comments, and CI log quotes in PR wakes;
- close-to-tray, and a fork-only schema that keeps upstream migrations intact.

Of the 23 existing CMDeck requirements, 13 are implemented, 7 partial and 3 absent. The absent ones are Docker
sandboxing, Windows Sandbox and the Kiro importer.

Three defects ship in v3:

- the MCP wizard crashes (open PR #23 fixes it);
- SSH remotes and headless installs fail, because CMDeck releases publish no CLI archives and `cliRelease.ts` still points at `pingdotgg/t3code`;
- several outbound requests have no opt-in: every linked hostname goes to Google's favicon service, the desktop update poll can't be switched off in Settings, and the Claude usage endpoint is polled. No test catches new outbound connections.

### What upstream T3 already provides

T3 Code already supplies most of the "Kiro" machinery CMDeck needs:

- a durable `effect/workflow` engine with failed-step retry (Labs);
- scheduled tasks with signed webhooks;
- `delegate_task` subagents;
- cross-thread MCP control;
- PR/CI watching;
- FTS5 thread search;
- forking, rewind and side chats;
- editable queued messages;
- a server-owned Playwright browser with human takeover;
- usage-limit recovery;
- linked environments;
- headless service;
- 11 providers plus ACP.

Upstream is now 324 commits ahead, mostly fixes. A sync is mechanical but large: about 119 conflicted
files, and 8 more that merge cleanly but won't compile. Upstream also has open PRs that CMDeck should
wait for rather than rebuild: computer use (#16530), usage budgets (#39893), OpenCode import (#41296),
fallback models (#43605), thread moves (#41771) and host extensions (#34534).

The official mobile app pairs with CMDeck over LAN or Tailscale without T3 Connect; this still needs one device test. Push notifications
and Live Activities are not available, because they require T3's hosted relay.

### What M3 Code can contribute

Little beyond what CMDeck already ported. The worthwhile pieces are:

- extra engine names (oMLX, Osaurus, Locals; S);
- a default thread environment (S);
- a scoped-down local engine manager (L, conditional).

M3's plugin host is **not** a safe isolation mechanism. Its sandbox is defeated by `allow-same-origin`, it sends no CSP, and its sidecars are unsandboxed. M3 has nothing for memory, agents, automation or sandboxing.

### What Kiro Crew can contribute

Kiro Crew contributes **behavior and data models, not code**. It is roughly 2.5M lines of Python wrapping agent CLIs over ACP. Worth porting as designs:

- its memory model (scopes, FTS5, decay as a ranking factor only, approval-gated skill creation);
- the `tasks.db` queue as a Task Runner model;
- the redaction engine;
- policy gates outside the model;
- the portability export, which is the importer's input.

Kiro's own security docs are candid, and the source matches them. Its weaknesses are the things not to copy:

- no OS sandbox on Windows;
- the vault key sits next to the vault;
- redaction is off by default;
- the audit log uses an HMAC chain that file deletion breaks;
- model-written Python runs in the gateway (Dynamic Workflows);
- browser use drives the real Chrome profile;
- default telemetry goes to `telemetry.us-east-1.kiro.dev`.

"Jev" is a hosted third-party API (TypeSafe), so CMDeck replaces it with local rules plus an optional
local model. **Kiro has no native Bedrock provider, model discovery, Guardrails or AgentCore**, so it is
not the reference for the Bedrock developer's needs.

### What other projects can contribute

Mostly patterns, rarely dependencies.

**Adopt as dependencies:** `grammy` (Telegram) and `@slack/bolt` (Slack, Socket Mode, no inbound port). `sqlite-vec` only if needed later.

**Copy as patterns:**

- Agent of Empires' container mount spec, with Agent Orchestrator's label-based reaping and Nimbalyst's no-network default, for the Docker sandbox;
- Podium's agent-mail brakes;
- Sillage's check-script gate;
- Paseo's relay hardening checklist;
- OpenChamber's repo-trust fingerprinting;
- Mem0/Graphiti/OpenClaw memory patterns on SQLite;
- PR-Agent's review budgeting;
- Jean's GitHub quota reserve.

**Avoid:**

- Screenpipe is now source-available;
- Alethe is AGPL;
- AutoGen is archived;
- many of the projects send telemetry by default.

Nothing here justifies Temporal, LangGraph, OPA or a vector or graph database.

### How much of the wishlist is redundant

**28 of the 73 selected Kiro features (38%) already exist** in CMDeck or are covered by the agent
harnesses or AWS's MCP servers. Another 23 extend an existing service. Only about 22 need a new subsystem,
and those collapse into a handful of shared modules. AWS needs no AWS SDK in early phases: Bedrock already
works through the Claude Code, Codex and OpenCode harnesses. What's missing is setup documentation, a preset,
and per-instance credential scoping (today `AWS_*` from the launching shell reaches every agent).

### The genuinely new work

59 work items ([IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)):

- **Phase 0 (9):** sync and repair. Upstream sync, PR #23, guard hardening, privacy fixes, an egress regression test, release archives, and a mobile device check.
- **Phase 1 (12):** foundations. Fork extension seams, redaction, a hash-chained audit log, the notification service, scheduler (cron, quota hold), the workflow trust gate, memory store core, the importer framework, and quick wins.
- **Phase 2 (21):** features.
  - Presets: Task Runner, Conductor/Work Ledger, Research Lab, Code Review Sage.
  - Bots, memory UI and lessons, local embeddings, Knowledge Library/Notes.
  - The decision service, check scripts, monitor loops and heartbeat health monitoring, usage alerts, and message pins.
  - A server-side approval policy, encrypted secrets, the container sandbox (Docker everywhere, Apple `container` on macOS), and a Windows Sandbox spike.
- **Phase 3 (11):** integrations. Telegram, Slack, the Kiro importer, app-state snapshots, skill proposals, Auto-Improvement, Ops Mission Control, LaTeX/PPTX, the PWA behind Access, Web Push, and AWS env scoping.
- **Phase 4 (6):** conditional. Agent Channels, Teams, the local engine manager, a web element picker, context breakdown, and the Windows Sandbox backend.

The new fork modules are: memory/knowledge store, notification delivery, decision service, messaging adapters, audit
log, sandbox runner, and the generalized importer. Everything else extends an upstream primitive.

### The most important architectural decisions

1. **Threads stay the unit of work.** Bots, Task Runner runs and conductors are ordinary threads, so the official mobile app keeps working. Protocol version 2 is never touched.
2. **One engine.** Every multi-step "app" (Task Runner, Spec Builder, Research Lab, Code Review Sage, Auto-Improvement, Ops) is a preset on the existing workflow engine. A **workflow file trust gate** comes first, because workflow files currently run in-process with server privileges and no approval.
3. **One scheduler and one event source.** `scheduledTasks` is extended. `MilestoneHub` stays as upstream wrote it, and a fork notification service owns delivery.
4. **One memory store.** SQLite items, revisions and FTS5, with agent-inferred lessons arriving as pending proposals. Notes and Knowledge stay files with an index. No vector or graph database.
5. **Rules before models.** Model risk flags are advisory only. Enforcement stays in the TypeScript permission layer.
6. **Fork isolation for mergeability.** New code lives in `apps/server/src/fork/<module>/`, a fork contracts module and `apps/web/src/fork/`, attached through guard-checked one-line hooks. Tables go in `ForkSchema`, never in numbered migrations.
7. **Sync at every upstream stable tag** with a hardened guard: a typecheck, and an `ensureForkSchema` check. Taking upstream's `Migrations.ts` as the current sync doc says would silently drop the fork tables.

### Highest-priority next steps

1. Approvals are answered (below), so the sync is unblocked.
2. Merge PR #23 (WI-0.01) and harden the guard (WI-0.02). Then sync to `v0.1.13` (WI-0.03).
3. Privacy fixes and the egress regression test (WI-0.04–0.06).
4. Fork extension seams (WI-1.01) and release archives (WI-0.08).
5. Memory store core (WI-1.07), scheduler extensions (WI-1.05), notifications (WI-1.04), the workflow trust gate (WI-1.06), and Bedrock guidance (WI-1.11).

### Decisions (answered 2026-11-26)

All 15 approvals were answered. Details: [RESEARCH_LEDGER.md](RESEARCH_LEDGER.md#approvals-2026-11-26).

- **Matched the recommendation:** keep upstream's tracing code but cut every exporter (A1); workflows on
  behind a trust gate (A2); strip inherited AWS credentials (A4); local models for background AI (A5);
  Teams not now (A7); publish CLI archives (A11); Agent Channels after Conductor (A13); Web Push yes
  (A14); keep dormant T3 Connect code (A15).
- **Link icons (A3):** off by default. The opt-in fetches each site's own icon, with no Google or
  DuckDuckGo middleman.
- **Heartbeat (A6):** means health monitoring: sessions alive, machines reachable, your own probes. Session
  notes were dropped as already covered. Context breakdown is as proposed.
- **Kiro transcripts (A8):** always imported, read-only.
- **Engine manager (A9):** management panel and install instructions, but CMDeck never runs installers.
- **Sandboxes (A10):** Docker everywhere, Apple `container` on Mac and Windows Sandbox. No Seatbelt.
- **Server secrets (A12):** sealed to the TPM via `systemd-creds` when present, otherwise a same-user key file.

**New features found during research** ([NEW_FEATURE_PROPOSALS.md](NEW_FEATURE_PROPOSALS.md)). Recommended:

- NEW-A01, a repo-config and external-content trust boundary;
- NEW-A02, agent-messaging brakes;
- NEW-A09, Web Push for the PWA (**now approved**, WI-3.11);
- NEW-B01, forget memory by source thread;
- NEW-B03, a stuck-loop detector;
- NEW-A05, worktree hygiene;
- NEW-A06, a GitHub API quota reserve;
- NEW-B04, review comment dedup.

Six more are "consider", eight "defer", and two "reject".

### Unresolved blockers and uncertainties

- **Merged tree not typechecked.** The audit was read-only, so the conflict counts are from `git merge-tree`.
- **No CMDeck tests were run.** "Implemented+tested" means tests exist in source, not that they pass.
- **Official mobile app needs one real-device check (WI-0.09).** Two fork commits disagree on how it handles a pending device approval.
- **Still to verify:**
  - whether the E2EE channel rejects replays and prevents downgrades;
  - SSH host-key pinning;
  - whether every webhook requires an HMAC.
- **Unchecked licenses:** `web-push`, the Teams SDK, and Kiro Crew's per-app licenses.
- **AWS caveats:**
  - several AgentCore capabilities (Memory, Policy, Evaluations) are not in every Region;
  - EC2, Fargate, S3 and SageMaker pricing was not verified;
  - classic Bedrock Agents is closed to new sign-ups.
- **No "Deferred" label in the brief's action vocabulary.** Deferred AWS and M3 items carry the closest label, and the roadmap's "Deferred despite being desirable" table is authoritative for them.

## Repository convention note

`AGENTS.md` normally keeps plans and research notes out of the repo. The brief asked for these
deliverables to live in CMDeck, so they are here. The files are uncommitted on `main`. Commit them on a
docs branch, or move them, when the roadmap is approved.
