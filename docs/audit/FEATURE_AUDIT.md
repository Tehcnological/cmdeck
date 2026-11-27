# CMDeck feature audit

Findings from the source audit of CMDeck `4a2f27d590` (v3, 3.0.0) against upstream T3 Code `9b4943f91c`,
M3 Code `6a8f1b0741` and Kiro Crew `b75544f0db`, audited 2026-11-26 ([SOURCES.md](SOURCES.md)).
The canonical per-feature record is [FEATURE_MATRIX.csv](FEATURE_MATRIX.csv) (260 rows, one per ID). This
document explains what the matrix means by category. It does not repeat each row. Evidence lives in the
research notes linked from each section.

How to read the statuses:

- `cmdeck_status` describes CMDeck at `4a2f27d590`. `t3_status` describes upstream main; for inherited
  features it equals CMDeck's.
- In a column whose repo was not the subject of a note, `Unverified` means "not examined", not "doubtful".
  The M3 column uses `Unverified` for T3 primitives that M3 inherits at its older base `5d02075446`.
- `Experimental` marks working, tested code behind a Labs flag (workflows, linked environments).
- For open upstream PRs, `Upstream available — incorporate` means "incorporate when merged". Lead decision D15
  says wait rather than rebuild.
- `D1`–`D16` are the lead decisions in [RESEARCH_LEDGER.md](RESEARCH_LEDGER.md#lead-decisions-synthesis-baseline).

## Status counts

CMDeck status by ID group:

| Group                         | Impl+tested | Impl | Partial | Experimental | Harness | Absent | Removed | Unverified | Total |
| ----------------------------- | ----------- | ---- | ------- | ------------ | ------- | ------ | ------- | ---------- | ----- |
| CMD (brief §4)                | 7           | 6    | 7       | 0            | 0       | 3      | 0       | 0          | 23    |
| Selected Kiro (AGT…MSG)       | 17          | 1    | 22      | 4            | 8       | 21     | 0       | 0          | 73    |
| BRK (brief §6)                | 1           | 1    | 2       | 0            | 1       | 8      | 0       | 0          | 13    |
| CMX (fork-only)               | 7           | 4    | 0       | 0            | 0       | 0      | 0       | 0          | 11    |
| T3 inherited primitives       | 21          | 4    | 0       | 2            | 0       | 0      | 0       | 0          | 27    |
| T3-U upstream additions       | 0           | 1    | 0       | 0            | 0       | 12     | 0       | 0          | 13    |
| M3                            | 14          | 8    | 3       | 0            | 0       | 16     | 1       | 0          | 42    |
| KCX + KCX-T (unselected Kiro) | 3           | 2    | 0       | 0            | 0       | 21     | 0       | 1          | 27    |
| NEW-A + NEW-B proposals       | 0           | 0    | 0       | 0            | 0       | 19     | 0       | 0          | 19    |
| EXC + EXC-U                   | 0           | 0    | 0       | 0            | 0       | 2      | 10      | 0          | 12    |

Recommended action, all 260 rows:

| Action                           | Rows | Action                                           | Rows |
| -------------------------------- | ---- | ------------------------------------------------ | ---- |
| Existing — retain                | 85   | Harness-provided — expose or integrate if needed | 13   |
| Partial — extend                 | 28   | Explicitly excluded — remove or avoid            | 18   |
| New — port or implement          | 26   | Not selected — do not introduce                  | 17   |
| Proposed — requires approval     | 28   | M3 available — incorporate or adapt              | 8    |
| Existing — improve               | 14   | Alternative implementation — evaluate            | 3    |
| Upstream available — incorporate | 15   | Planned/incomplete — finish existing work        | 3    |
|                                  |      | Unverified — insufficient evidence               | 2    |

Counts updated 2026-11-26 after reconciling actions with the roadmap (see FEATURE_COVERAGE.md, Reconciliation log).

## Wishlist items redundant with existing functionality

The selected Kiro wishlist has 73 items. **20 already exist** in CMDeck as working, tested code. These need
at most an improvement, not a new subsystem. **8 more are covered by harnesses or AWS MCP servers** and need
documentation or a thin UI. That makes **28 of 73 (38%) redundant**. Another 23 are partial and extend
existing services. Only 22 need new subsystems, one of which (MSG-03 Teams) is scheduled behind approval A7.

Already in CMDeck (inherited from T3 unless noted):

| ID     | Wishlist name                   | What already does it                                                                                               |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AGT-03 | Conductor mode                  | Any thread conducts via `delegate_task`, `t3_thread_send`, `t3_thread_wait` (`mcp/toolkits/orchestrator/tools.ts`) |
| AGT-04 | Parallel subagents              | `delegate_task` with worktree isolation, workflow `within` pools, Agents panel                                     |
| AGT-05 | Dynamic Workflows               | `effect/workflow` engine in `apps/server/src/workflows` (Labs)                                                     |
| AGT-06 | Selective workflow retry        | Failed step pauses; `resume` reruns only that step (Labs)                                                          |
| AUT-01 | Cron jobs                       | Scheduled tasks (`scheduledTasks/ScheduledTaskService.ts`); lacks cron syntax only                                 |
| AUT-05 | PR monitoring                   | `PullRequestWatchService`, `watch_pull_request`, `ci_logs`; fork adds log quotes (CMD-15)                          |
| AUT-06 | Inbound webhooks                | `/api/hooks/:hookId/:token` route with verification, filter, template                                              |
| AUT-07 | Automatic quota recovery        | `UsageLimitRecoveryWorker`                                                                                         |
| CHT-01 | Session search                  | FTS5 `ThreadSearch`, palette, mobile                                                                               |
| CHT-02 | Session forking                 | `ThreadForkService`, rewind, side chats, merge-back                                                                |
| CHT-03 | Cross-session control           | `t3_thread_*` MCP tools, `t3 thread` CLI                                                                           |
| CHT-05 | Editable queued messages        | `QueuedRunOrder`, `t3_queue`                                                                                       |
| TLS-01 | Live browser with takeover      | `preview/ServerBrowser.ts`, `SessionControl.ts`                                                                    |
| INF-01 | Remote Crew                     | Linked environments and remote delegation (`peer/*`, Labs)                                                         |
| INF-02 | Headless gateway                | `t3 service install`, `McpHttpServer`                                                                              |
| INF-04 | Crash and orphan recovery       | `ProviderRuntimeRecoveryService`, `RestartContinuation`, `agentScope`                                              |
| INF-05 | Independent permission policies | Runtime modes, `ManagedPolicy`, `McpToolAccess`                                                                    |
| INF-11 | Alternative harnesses and ACP   | 11 providers plus the ACP registry (= CMD-11)                                                                      |
| DEV-01 | Code Review Sage                | Second-model review (fork, CMD-16), PR review guides, diff batch bar, CI log wakes                                 |
| DEV-04 | Design Tweak                    | Desktop element picker (`apps/desktop/src/preview/PickTarget.ts`)                                                  |

Covered by harnesses or MCP servers: MEM-04 (repo `AGENTS.md`/`CLAUDE.md`), TLS-02 (provider computer use;
upstream #16530 pending), TLS-03 (provider skills surfaced in the composer), PRD-02 (`.pptx` generation via
skill/MCP, viewer exists), AWS-01, AWS-02, AWS-03 and AWS-04 (AWS MCP Server and awslabs servers; an EC2
box on Tailscale is already a CMD-12 environment).

Partly redundant: INF-12 (session importer exists; skills, memory and instructions import missing), plus the
22 `Partial — extend` rows, each of which builds on a named existing service.

## Privacy, telemetry and phone-home

Notes: [cmdeck-fork.md §3](research/cmdeck-fork.md#3-remaining-outbound-endpoints-appsserver-appsdesktop-appsweb),
[UPSTREAM_SYNC.md](UPSTREAM_SYNC.md#must-reject-or-strip), [M3_CODE_ANALYSIS.md §2.2](M3_CODE_ANALYSIS.md).

**What exists.** Telemetry, analytics, crash and OTLP export are deleted, not stubbed, and `scripts/fork/guard.sh`
forbids their return (EXC-01, CMD-01). No CMDeck-operated service exists (CMD-06). Provider subprocesses get
`DO_NOT_TRACK`-style opt-outs (`provider-core/src/server/instanceEnvironment.ts`, M3-13).

**Partial: CMD-01.** Automatic egress with no opt-in remains:

- `www.google.com/s2/favicons` for every linked host (`packages/shared/src/favicon.ts:81`, inherited, no switch).
- Desktop update poll every 4 h (`DesktopUpdates.ts`), switchable only by env or policy.
- Claude `oauth/usage` on every Claude provider check (`claudeResetCredits.ts:216`).
- Model manifest from CMDeck's own repo plus provider version checks (one toggle, on by default).
- `git fetch` every 30 s on the balanced profile.

The LiteLLM price table (`UsageService.ts:73`) is fetched only when Usage opens. That is documented in
`docs/user/telemetry.md`, and I verified it in source while resolving an M3 question. No egress regression test
exists. `t3 update` and `t3 triage` still name `pingdotgg/t3code` (`packages/shared/src/cliRelease.ts:6`,
verified, and `triage/triagePrompt.ts:37`).

**Upstream.** Upstream fixes a remote-load path in theme CSS (#39408). It converged with the fork on Antigravity
(#43026, #43087). It still ships analytics and tracing, which costs 11 modify/delete conflicts and 8
compile-only breaks per sync (EXC-U01..U03). D2 (needs approval) decides whether to keep upstream's
local-only tracing or an inert stub. Open #42625 (usage-data toggle default on, EXC-U05) and #17586
(background self-update from upstream, T3-U13) must be rejected or repointed.

**Kiro contrast.** Kiro ships default-on product metrics to `telemetry.us-east-1.kiro.dev`, a daily beacon, CDN
model downloads and a hosted decision API (KCX-03, KCX-04, KCX-T02, TLS-05). None of these may be inherited.

## Remote access and connectivity

Notes: [cmdeck-fork.md §2](research/cmdeck-fork.md#2-cmd-requirement-status-verified-in-source),
[M3_CODE_ANALYSIS.md](M3_CODE_ANALYSIS.md), [competitive-ades.md](research/competitive-ades.md).

**What exists.**

- T3 Connect is cut at the boundary (`policy/managedLimits.ts` `allowsConnect = () => false`). LAN, Tailscale
  (`packages/tailscale`) and user-run tunnels keep working (CMD-02, CMD-03).
- Remote MCP has opt-in bearer tokens (`auth/RemoteMcpTokens.ts`, CMD-05).
- Device approval for pairing is on by default (CMX-04).
- Opt-in E2EE covers RPC and attachments (`packages/shared/src/socketE2ee.ts`; CMX-03, ported from M3-17/18
  and hardened).
- Linked environments and remote delegation are Labs (T3-14, INF-01). The M3 Add-project dialog is ported (M3-25).

**Partial.**

- **CMD-04:** Cloudflare Access is enforced only at the edge, with no server-side `Cf-Access-Jwt-Assertion` check.
- **CMD-12:** SSH bootstrap downloads the server from `T3CODE_RELEASE_BASE_URL`. CMDeck releases publish no CLI
  archives, so SSH remotes fail closed without a mirror. M3's runtime upload (M3-23) was not ported.
- **CMD-02 / M3-21:** the Connect-only MCP wizard crashes on main (Clerk `useAuth`). Open CMDeck PR #23 fixes it.
  This is a **UI without a backend**.

**Rejected M3 pieces.** M3-19 mTLS replaces the main listener and locks out the official apps. M3-20
`apps/m3-server` is an orphaned **backend-only** control plane.

**Upstream.** #39489 limits delegated-mode choice to full-access MCP callers (incorporate). Open #43338
(numeric Tailscale address) and draft #41771 (move threads between environments) are pending.

**Open questions.** Does `socketE2ee.ts` reject replays and pin against downgrade (CMX-03)? Does
`packages/ssh/src/tunnel.ts` pin host keys (CMD-12)?

## Mobile and PWA

Notes: [cmdeck-fork.md §2.2](research/cmdeck-fork.md#22-official-mobile-app-compatibility), [UPSTREAM_SYNC.md §Mobile pairing](UPSTREAM_SYNC.md#mobile-pairing).

**What exists.** The official app pairs directly over LAN or Tailscale. Protocol 2 is guarded, fork RPCs are
additive, and the two removed RPCs are not used by mobile (CMD-22). Upstream mobile 2.4 works without Connect.
The web app has a responsive layout and an installable manifest (CMD-23).

**Partial or missing.**

- Official-app push and Live Activities are **hosted-dependent** (T3 relay) and therefore off. D8 accepts this.
- The official app cannot pass Cloudflare Access.
- The PWA has no service worker and no Web Push. NEW-A09 (VAPID Web Push) fills this; D8 originally favoured it,
  but the roadmap keeps it pending approval (A14).
- EXC-U06 (self-hosted relay, open #34302) is the only route to official-app push and probably cannot work,
  because the app reads a built-in relay URL.

**Unresolved.** Nobody has run a device test with a store build. Commits `ba004a8f06` and `8b51f2a348` disagree on
whether the app retries pending approval; the client-runtime test supports the later commit.

## Local inference and providers

Notes: [M3_CODE_ANALYSIS.md §3–4](M3_CODE_ANALYSIS.md#3-incorporation-status-in-cmdeck), [cmdeck-fork.md](research/cmdeck-fork.md).

**What exists.** M3's inference stack is incorporated (M3-01..08, M3-41, CMD-07): registry, gateway with
queues, fallback and turn affinity, discovery, watchdog, image checks and a request log, all in `ForkSchema.ts`
tables. Pi, OMP, OpenCode and Codex link to local servers through the gateway; Codex-on-local is labelled
**Experimental** (`codexGateway.ts:250`). Providers: Codex, Claude, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi,
OMP, Muse and fx, plus the ACP registry. goose runs as a generic ACP agent (CMD-11, INF-11).

**Missing.**

- Engine lifecycle: M3-09 can start, stop, pull and load engines. It is not ported, needs a product decision, and
  has security caveats.
- MLX engine names (M3-10, S).
- Local-model evals (M3-11).
- Antigravity usage limits via the official CLI (M3-15). It is gated on whether that CLI surface is documented.

**Native vs harness.** The gateway is native. Each agent's use of a model is harness behaviour. Before CMDeck,
upstream reached local models only through harness config (`t3_status` Harness-provided).

## Execution environments and sandboxing

Notes: [cmdeck-fork.md](research/cmdeck-fork.md), [competitive-ades.md](research/competitive-ades.md), [kirocrew-tools-infra-apps.md §INF-09](research/kirocrew-tools-infra-apps.md).

**What exists.** Close to tray and launch at login are fork additions. The background service is inherited
(CMD-13). Desktop builds exist for Windows x64, macOS arm64 and Linux x64, all unsigned (CMD-08). The only
sandboxing is harness permission and sandbox modes (INF-09).

**Absent.**

- **CMD-09 Docker:** not found by grep. Upstream #15350 is stalled.
- **CMD-10 Windows Sandbox:** no reference in any of the 20 competing projects, and Kiro has no Windows sandbox.

D11 sets the CMD-09 spec: Agent of Empires' mount table, Agent Orchestrator's label reaper, egress off by
default, and the whole provider process inside the container. CMD-10 starts with a feasibility spike.

**Partial: CMD-08.** There are no CLI archives (this also blocks CMD-12). There are no macOS x64 or Linux arm64
builds, and the Windows test job was deleted with the upstream workflows (EXC-06).

**Kiro is not a reference for real isolation.** Its "OS sandboxing" is a credential file fence with no egress
control and no Windows support. INF-09 is therefore marked `Alternative implementation — evaluate` and depends on
CMD-09 and CMD-10.

## Git, review and CI

**What exists.** All of these are tested: Git, worktrees and multi-repo (T3-26), checkpoints (T3-06), PR watch
(T3-04), batched diff comments (CMD-14, fork batch bar), CI log quotes in wakes (CMD-15, fork), second-model
review (CMD-16, fork) and Vikunja (CMX-07).

**Upstream.** Upstream #42428 adopts `gt` for Forgejo/Gitea. That makes the fork's `gt`/`tea` variant (CMX-08,
M3-35) redundant, and taking upstream removes 6 conflicted files. Upstream also has worktree fixes (CMD-17).

**Proposals.** NEW-A05 (worktree hygiene), NEW-A06 (GitHub quota reserve), NEW-A08 (committee review skill),
NEW-A12 (more trackers) and NEW-B04 (review dedup) are proposals only.

**Mobile.** Diff comments are web and desktop only.

## Migration and import

Notes: [cmdeck-fork.md §2.1](research/cmdeck-fork.md#21-is-t3import-extensible-for-a-kiro-crew-importer), [kirocrew-agents-memory-automation-chat.md §6](research/kirocrew-agents-memory-automation-chat.md).

**What exists.** `cmdeck import-from-t3` copies folders, snapshots SQLite and scrubs identity (CMD-19). It is
**CLI only**; the toast just shows the command. The inherited agent-session importer brings in Claude, Codex and
Pi sessions (T3-21, INF-12).

**Conflict resolved: CMD-21.** The CMDeck note marked CMD-21 Absent. The coverage note verified
`AgentSessionImporter`, and I confirmed `AgentSessionSource = ["claudeAgent","codex","pi"]`
(`packages/contracts/src/agentSessions.ts:5`). CMD-21 is therefore Partial.

**Absent: CMD-20 (Kiro import).** D16 generalizes the T3 importer into `cmdeck import <source>`. It would read
Kiro's portability zip (KCX-12) and map records the way `LegacyV1ThreadImporter` does. Upstream open #41296
(OpenCode import) is the next template.

KCX-11 (Kiro onboarding importer) is the same Kiro module as INF-12 and is tracked there.

## Agents and orchestration

Notes: [cmdeck-wishlist-coverage.md §AGT](research/cmdeck-wishlist-coverage.md#agt--agents-and-autonomous-execution), [kirocrew-agents-memory-automation-chat.md §2](research/kirocrew-agents-memory-automation-chat.md#2-agents-and-autonomous-execution-agt), [competitive-libraries.md §4](research/competitive-libraries.md#4-durable-execution-agt-05-agt-06-inf-03-inf-04).

**What exists.** `delegate_task` subagents (T3-03), provider-native `/goal` (T3-17), conducting via MCP thread
tools (AGT-03) and a durable `effect/workflow` engine (T3-01, AGT-05/06). The engine has journaled steps,
durable waits and triggers. It is **Experimental**: Labs flag `workflowsEnabled` is off by default. No
durable-execution dependency is warranted.

**Partial.**

- AGT-01 Task Runner and AGT-02 Persistent Bots: built from scheduled tasks, goals and workflows. Missing are the
  plan-execute-verify preset and a bot profile (D7).
- AGT-09 Agent Channels: point-to-point messages exist; no room thread.

**Absent.** AGT-10 Research Lab (a workflow preset under D4).

**Ambiguous Kiro names.**

| ID                    | Kiro meaning (source)                                                                                                    | Plain meaning                 | Recommended interpretation                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| AGT-07 Work Ledger    | SQLite work items with conductor/worker split ownership; worker reports are schema-bound data (`work_ledger.py`)         | Log of work done              | Kiro's, as a fork table serving AGT-03, shown as a list (never a board) |
| AGT-08 Session Ledger | Per-thread structured state card written by an MCP tool, re-injected on wakes and after compaction (`session_ledger.py`) | Session history log           | Kiro's (small); a thread export is a separate item                      |
| AGT-09 Agent Channels | Room thread: orchestrator by default, @mention routing, dispatch tools denied; shipped hidden (`channel.py`)             | Named agent-to-agent channels | Kiro's, lower priority than the conductor, with NEW-A02 brakes          |

**Security.** Workflow files are TS modules hot-reloaded from `~/.cmdeck/workflows` through a dynamic `import()`
(`WorkflowRuntime.ts:151`). An agent-written "dynamic workflow" therefore runs code with server rights
(inferred). Kiro executes model-authored Python behind an AST blocklist. Neither approach should graduate
without a declarative plan format.

## Memory and knowledge

Notes: [kirocrew-agents-memory-automation-chat.md §3](research/kirocrew-agents-memory-automation-chat.md#3-memory-and-learning-mem), [competitive-libraries.md §2](research/competitive-libraries.md#2-memory-mem-0110).

**What exists.** Nothing native. Memory is **harness-provided** (`CLAUDE.md`, `AGENTS.md`, Codex memories) and
can be edited only as files (MEM-01, MEM-02, MEM-04). Usable building blocks are the FTS5 message index
(migration 069) and the `ForkSchema.ts` table pattern.

**Absent.** MEM-03 and MEM-05..10. D6 settles the design:

- One fork SQLite store with a `scope` column (global, project, `bot:<id>`), a revisions table and FTS5.
- Agent-inferred items arrive as pending proposals. Kiro ships its poisoning gates off; CMDeck should not.
- Optional embeddings run only through the local inference gateway, never as an auto-download.
- Exposed as MCP tools plus provider instruction materialization.
- Notes (PRD-03) and the Knowledge Library (MEM-10) are document-type items in the same store.

**Reverse states.** MEM-06 incognito needs KCX-10 (promote to persistent) as its way out, per AGENTS.md.

**Proposals.** NEW-B01 (forget by source thread) and KCX-17 (failure card) need approval.

## Automation and scheduling

Notes: [kirocrew-agents-memory-automation-chat.md §4](research/kirocrew-agents-memory-automation-chat.md#4-automation-and-scheduling-aut), [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md).

**What exists.** Scheduled tasks (interval, fixed time, once, webhook), inbound webhooks, PR watch and quota
recovery are all tested (AUT-01, AUT-05, AUT-06, AUT-07). Upstream has scheduling fixes (#43139, #43255, #43610)
and open fallback model chains (#43605).

**Partial.**

- AUT-01 lacks cron expressions and timezones.
- AUT-02 is possible only through Labs workflows. Scheduled tasks always run an agent, and there is no
  check-script gate.
- AUT-04 relies on Claude's own Monitor and ScheduleWakeup (harness).
- AUT-06 docs (`docs/user/project-settings.md`) still describe T3 Connect held webhooks.

**Ambiguous: AUT-03 Heartbeat monitoring.**

- Kiro meaning: a `HEARTBEAT.md` agent task queue plus maintenance chores (`heartbeat.py`).
- Plain meaning: liveness or health monitoring. CMDeck already has internal liveness (socket heartbeat, inference
  watchdog, recovery).
- Paseo meaning: an agent self-heartbeat tool.
- **Recommended:** an agent self-schedule MCP tool over scheduled tasks (D5). Health stays in INF-04. No
  `HEARTBEAT.md`.

KCX-16 (self-arming nudges) folds into AUT-03 and AUT-04.

## Chat and sessions

**What exists.** All tested: search (CHT-01), fork/rewind/side chats/merge-back (CHT-02, KCX-05, KCX-06,
KCX-08), cross-thread control (CHT-03), the editable queue (CHT-05), snooze/wake (T3-16) and the prompt stash
(KCX-09, verified as `ComposerStashMenu`).

**Partial.**

- CHT-04: panes exist for subagents, side chats and linked threads, but there is no general split.
- CHT-06: quoting exists; pinning is missing.
- CHT-07: totals exist, but providers assemble their own context, so any breakdown can only be honest and
  partial.

**Ambiguous names.**

| ID                          | Kiro meaning                                                                                                                                                            | Plain meaning                      | Recommended                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| CHT-08 Quiet-turn indicator | `nothing_to_do` MCP tool / `(quiet)` end token on automated turns: compact row, finished not interrupted, no unread/notify (`session_directive.py`, `acp/end_token.py`) | A visual "silent/idle turn" marker | Kiro's: an MCP tool on automated turns only                             |
| CHT-09 Session notes        | Note injected into a thread: visible row plus one-shot next-turn context, no turn started (`slot_note.py`)                                                              | Per-thread user scratchpad         | Kiro's (serves automations); a scratchpad is a separate trivial request |

**Upstream.** Open #43623 thread map (T3-U05) and draft #43754 (mobile reply and edit) are pending.

## Tools, browser and the decision service (Jev)

Notes: [kirocrew-tools-infra-apps.md §TLS](research/kirocrew-tools-infra-apps.md#tls-tools-and-customization), [competitive-libraries.md §5–6](research/competitive-libraries.md#5-browser--computer-use-tls-01-tls-02-dev-04-dev-05).

**What exists.**

- The live browser with takeover is tested (TLS-01, T3-08): Playwright `ServerBrowser`, CDP screencast and
  `SessionControl`.
- Device tools and SnapShot (T3-18).
- Provider skills in the composer (T3-09, TLS-03, **harness-provided**).
- Computer use only inside harnesses (TLS-02). Wait for upstream #16530 (D15).
- Lifecycle hooks only inside harnesses (TLS-04). Native project scripts and worktree setup are not agent hooks.

**Jev (TLS-05..08).** Kiro's default is a **hosted third-party API** (TypeSafe, `api.typesafe.ai`), with local or
SageMaker as options. That default is excluded. CMDeck already has deterministic failover and load balancing in
the inference gateway (TLS-05 Partial). D9 replaces all four Jev functions with one rules-first DecisionService.
It may use an optional local model and is never a security boundary. Risk flags (TLS-08) are annotations only.

## Security and infrastructure

Notes: [kirocrew-tools-infra-apps.md §Security model reality check](research/kirocrew-tools-infra-apps.md#security-model-reality-check).

**What exists.**

- Permission policies are tested (INF-05; T3-19 managed policy). Upstream adds push-hook approval (#42535) and
  ACP edit scoping (#43046).
- Crash and orphan recovery (INF-04).
- Secret providers and requests (T3-20).
- Usage tracking (T3-07).

**Partial.**

- INF-06: secrets are 0600 files, not encrypted at rest. D10 adds an OS-keychain key with a documented headless
  fallback; KCX-T07 adds mediated injection.
- INF-07: logs and settings are redacted; transcripts and outbound content are not.
- INF-03: only workspace checkpoints exist; no app-state snapshot.
- INF-10: usage tracking exists, but there are no budgets or alerts, and push is a no-op. Upstream #39893 and
  #29931 are pending.

**Absent.** INF-08 hash-chained audit log. No competitor has one; Kiro's is HMAC-chained with a same-user key.
NEW-A01 (repo trust fingerprinting) and NEW-B02 (untrusted-content envelopes) are proposals.

## Developer apps

DEV-01 and DEV-04 exist (see the redundancy table). DEV-03 Spec Builder (plan mode plus Kiro's Spec agent) and
DEV-05 Design Critique (preview tools) are partial. DEV-02 Auto-Improvement and DEV-06 Ops Mission Control are
absent.

D4 makes all of them presets on the workflow engine, not separate apps as in Kiro. Kiro's apps all ship
`defaultEnabled: false`. Upstream open #36693 and #27253 (host monitoring, T3-U06) feed DEV-06.

## AWS and Bedrock

Notes: [AWS_BEDROCK.md](AWS_BEDROCK.md).

**What exists.**

- Claude Code on Bedrock is **Implemented+tested, harness-driven**: env routing (`ClaudeCodeModelRoutes.ts`),
  auth labels (`ClaudeProvider.ts:207-231`), model mapping and Bedrock pricing.
- Managed policy can force Bedrock.
- Codex on Bedrock is a label only. OpenCode's Bedrock provider is entirely harness-side.
- CMDeck is inert by construction: no `@aws-sdk/*` and no AWS calls.

**Gaps.**

- No Bedrock documentation (BRK-INF).
- Ambient `AWS_*` env reaches every agent because provider env inherits `process.env` (BRK-AUTH.08, inferred
  from `ClaudeDriver.ts:125`).
- Cost attribution is an estimate only (BRK-COST.01-03).

**Recommendation (D12).** AWS-01..04 and the KB, cost and infrastructure areas go through the AWS MCP Server and
the awslabs servers (harness-provided, documented, IAM-gated, read-only by default). Batch, prompt management,
evaluations and AgentCore are deferred as `Proposed — requires approval`. Classic Bedrock Agents are closed to
new sign-ups. AWS-05 waits for the DecisionService.

**Paid.** Every BRK and AWS item that creates resources costs money. Ongoing charges come from KB indexes,
AgentCore Gateway and Memory, CloudWatch logs, SageMaker real-time endpoints and EC2. Cost Explorer charges
$0.01 per API call, so it must never be polled.

## Productivity and messaging

**Productivity.** PDF and OpenXML viewers and HTML renders exist (T3-22). PRD-01 Papyrus needs a sandboxed LaTeX
compile; PRD-02 PPTX needs only a skill or MCP server; PRD-03 Notes goes into the memory store (D6, D14).

**Messaging.** MSG-01..03 are absent. The event source is `MilestoneHub` (T3-15). D5 originally made it
persistent; the roadmap keeps it unchanged and in-memory, and a fork notification service (WI-1.04) subscribes
to it with its own delivery outbox. D13's adapter interface sits on that service. Telegram (`grammy`) and
Slack (`@slack/bolt`, Socket Mode) need no inbound port. Teams needs Azure Bot registration and a public
endpoint, so it is scheduled last (WI-4.02) behind approval A7. Messaging is also the main way to reach a user away from
the app, given that official-app push is unavailable.

## Fork maintenance and upstream sync

Notes: [UPSTREAM_SYNC.md](UPSTREAM_SYNC.md), [cmdeck-fork.md §5](research/cmdeck-fork.md#5-merge-burden-hotspots).

**State.** CMDeck is 339 commits ahead and 324 behind upstream. The guard and sync scripts pass (CMX-10).
Merging `v0.1.13` predicts 114 conflicts plus 8 files that merge cleanly but no longer compile.

**Fixes (D1).** Add a typecheck after merge, add an `ensureForkSchema` required entry, and drop the fork patches
upstream now matches (Antigravity, Forgejo `gt`).

**Merge burden.** The biggest recurring cost is the telemetry fan-out (D2). The fork's settings reorganisation
(CMX-11) and identity strings (CMX-01) also conflict every time. T3-U01..U12 arrive with a normal merge. If
upstream #34534 (host extensions, T3-U04) merges, it could host CMDeck-only features and cut the fork surface.

## Distinctions required by brief §2

| Distinction                  | IDs                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inherited from T3            | T3-01..27; CMD-03, CMD-11, CMD-17, CMD-18; most retained AGT/AUT/CHT rows                                                                                               |
| Incorporated from M3         | M3-01..08, M3-13, M3-17/18, M3-22, M3-25/26, M3-29 (partial), M3-32..35, M3-41; CMX-03, CMX-07, CMX-08, CMX-09, CMX-11                                                  |
| Harness-provided             | MEM-01/02/04, TLS-02, TLS-03, TLS-04, AUT-04 (Claude Monitor), INF-09, BRK-AUTH, BRK-INF; AWS-01..04 via MCP                                                            |
| Backend without UI           | CMD-19 (CLI only; toast shows the command); M3-20 (M3, unwired); Kiro KCX-05 merge-back is API-only in Kiro                                                             |
| UI without complete backend  | Connect-only MCP wizard on main (CMD-02/M3-21, crash fixed by open PR #23); push settings with a no-op relay (CMD-22); M3-37 bridge commands with no listener (M3 only) |
| Fully implemented and tested | 70 rows `Implemented+tested` (matrix)                                                                                                                                   |
| Experimental / Labs          | T3-01/AGT-05/AGT-06/AUT-02 (`workflowsEnabled`), T3-14/INF-01 (`linkedEnvironmentsEnabled`), Codex on local servers (CMD-07)                                            |
| Incomplete                   | CMD-02 (PR #23), CMD-12 (no CLI archives), M3-21                                                                                                                        |
| Planned upstream             | CMD-09 #15350, TLS-02 #16530, AUT-07 #43605, INF-10 #39893/#29931, CMD-21 #41296, CMD-03 #43338, T3-U04..U06                                                            |
| Hosted-dependent             | EXC-02 (Connect), CMD-22 push/Live Activities, KCX-T02 (Kiro relay), Jev hosted default (TLS-05..08)                                                                    |
| Paid third-party             | CMX-08/M3-33 LLM Gateway (opt-in), AWS-01..05 and BRK-* usage, MSG-03 Azure registration, KCX-T05 Polly/Transcribe                                                      |

## Conflicts between research notes and how they were resolved

| #   | Conflict                                                                                                                           | Resolution                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The coverage note assigned CMX-01..08 (second-model review, E2EE, …); the CMDeck note owns CMX and assigned CMX-01..11 differently | CMDeck note wins (ledger owner). Coverage CMX items map to CMD-16, CMX-03, CMD-07, CMD-19, CMD-14, CMD-15, CMD-05/CMD-04, CMD-13                                                         |
| 2   | competitive-ades says CMD-14 is "In CMDeck (CMX-05)"; T3-27 notes say E2EE is "CMX-02"                                             | Same numbering clash; the matrix uses CMD-14 and CMX-03                                                                                                                                  |
| 3   | Both Kiro agents used KCX-01.. for different features                                                                              | The kiro-1 numbering stays KCX-01..17; kiro-tools renumbered KCX-T01..T10. KCX-T03 duplicates KCX-03; KCX-11 duplicates INF-12                                                           |
| 4   | CMD-21 marked Absent by the CMDeck note                                                                                            | Agent-session importer verified in source (agentSessions.ts:5). Now Partial                                                                                                              |
| 5   | kiro-1 guessed CMDeck "likely has" AUT-01/05/06, CHT-01/02/03/05 and "not found" CHT-04 by keyword                                 | Coverage note verified in source: those exist; CHT-04 is Partial                                                                                                                         |
| 6   | kiro-1: KCX-05 merge-back "needs approval"; KCX-06/08/09 "check overlap"                                                           | Merge-back exists (`ThreadManagementService.ts`, `ThreadMergeBack.integration.test.ts`), rewind (`useTimelineRewind.ts`) and stash (`ComposerStashMenu`) verified: all Existing — retain |
| 7   | kiro-tools asked whether CMDeck has takeover (TLS-01)                                                                              | Coverage verified `SessionControl` takeover: Existing — improve                                                                                                                          |
| 8   | kiro-tools: INF-12 and INF-03 "New — port"; INF-04 and TLS-04 "Partial — extend"; DEV-04 "Partial"                                 | Verified CMDeck status kept: INF-12 and INF-03 Partial — extend; INF-04 Existing — improve; TLS-04 Harness-provided status with Partial — extend action; DEV-04 Existing — improve       |
| 9   | Coverage rated AGT-07/08 Partial on the plain meaning                                                                              | Recommended Kiro meaning is absent: New — port or implement (status kept Partial, explained)                                                                                             |
| 10  | Coverage rated workflows and linked environments Implemented+tested "(Labs)"                                                       | Status `Experimental` (tested but flag-gated) per brief §2                                                                                                                               |
| 11  | AWS note proposed `Proposed — requires approval` for AWS-03 and AWS-05                                                             | Both are selected features. AWS-03 becomes Harness-provided (EC2 on Tailscale = CMD-12); AWS-05 becomes New, deferred until TLS-05 (D12)                                                 |
| 12  | competitive-libraries: INF-10 "Existing — retain" vs coverage Partial (no alerts)                                                  | Partial — extend (alerts), waiting for upstream usage PRs (D15)                                                                                                                          |
| 13  | AGT-06 Kiro Partial vs CMDeck Implemented+tested                                                                                   | Failed-step retry exists (Existing — retain); retry from an arbitrary step is deferred and proposed upstream (roadmap)                                                                   |
| 14  | UPSTREAM_SYNC.md table calls the thread map T3-U11; upstream-sync.csv calls it T3-U05                                              | The CSV is canonical: T3-U05 thread map, T3-U11 benchmark tooling                                                                                                                        |
| 15  | M3 note asked whether CMDeck still fetches ModelManifest and LiteLLM from raw.githubusercontent.com                                | Verified: manifest from CMDeck's own repo (`ModelManifest.ts:29`); LiteLLM from BerriAI when Usage opens (`UsageService.ts:73`), documented                                              |
| 16  | competitive-libraries asked what Jev is                                                                                            | kiro-tools confirmed the hosted TypeSafe API is Kiro's default. Excluded; D9 replaces it                                                                                                 |
| 17  | MSG-03 is selected but needs Azure registration and public ingress                                                                 | Selected, so `New — port or implement`, scheduled conditionally as WI-4.02 behind approval A7 (changed from `Proposed` in the coverage pass)                                             |

## Explicitly excluded

| ID              | What                                                                                                  | Why                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| EXC-01          | Product analytics, crash reporting, OTLP/trace export                                                 | Telemetry (§3 exception)                                                            |
| EXC-02          | T3 Connect, hosted relay, Clerk                                                                       | T3 Connect dependency                                                               |
| EXC-03          | Antigravity Google-internal quota probing, fake SSH session                                           | Unnecessary phone-home / provider terms                                             |
| EXC-04          | Upstream release feeds and installers                                                                 | Phone-home to upstream; replace with CMDeck's own archives                          |
| EXC-05          | Expo OTA updates                                                                                      | Phone-home                                                                          |
| EXC-06          | Upstream mobile/relay/AUR/preview CI                                                                  | Upstream infrastructure (restore a Windows test job under CMD-08)                   |
| EXC-U01..U05    | Upstream analytics edits, tracing/OTLP, client trace hooks, relay changes, usage-data toggle (#42625) | Telemetry and Connect; strip on every sync (EXC-U04 merges harmlessly as dead code) |
| T3-U13          | Background self-update from upstream (#17586)                                                         | Phone-home unless repointed to the CMDeck feed                                      |
| KCX-01, KCX-02  | Kiro crew board, chat-tag board columns                                                               | Kanban/board interfaces                                                             |
| KCX-03, KCX-T03 | Kiro beacon and product metrics                                                                       | Telemetry                                                                           |
| KCX-04          | Kiro default-on CDN downloads and update checks                                                       | Phone-home                                                                          |
| KCX-T02         | Kiro relay and managed environments                                                                   | Vendor-hosted intermediary                                                          |
| (TLS-05..08)    | Hosted Jev/TypeSafe decision API as a default                                                         | Hosted third-party dependency; replaced by D9                                       |

Excluding these does not remove remote connectivity, mobile pairing or any working local feature (brief §3).

## New proposals requiring approval

These 28 rows are not roadmap scope:

- NEW-A01..A13: competing ADEs. The researcher recommends A01, A02, A05, A06 and A09, considers A03, A04, A07,
  A08 and A10, defers A11 and A12, and rejects A13.
- NEW-B01..B06: libraries. The researcher would approve B01–B04, defer B05, and propose B06 after INF-06.
- KCX-14, KCX-15, KCX-17, KCX-T06, KCX-T07 and KCX-T10 (proposals NEW-C03, C04, C02, C05, B06, C06 in
  NEW_FEATURE_PROPOSALS.md, which also merges NEW-B02 into NEW-A01).
- The deferred AWS areas BRK-INF.08, BRK-PRM and BRK-AGC.

Details are in [competitive-ades.md](research/competitive-ades.md#new-proposals) and
[competitive-libraries.md §9](research/competitive-libraries.md#9-new-proposals-require-approval-not-roadmap-scope).
