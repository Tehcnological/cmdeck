# Competitive agent development environments (brief §7.1, §7.8)

Research note for the CMDeck audit. Agent: competitive-ADE researcher (prefix `NEW-A`). Accessed 2026-11-26.
Method: brief §7.9 staged approach. Stage 1 for every project via `gh api` (license from `repos/{r}/license`
plus a read of the LICENSE text, HEAD SHA from `repos/{r}/commits`). Stages 2–4 from shallow blobless clones
(`git clone --depth 1 --filter=blob:none --no-checkout`, read with `git show HEAD:<path>`; nothing executed).
Evidence format: `repo@sha7:path` + symbol. "(docs-only)" = README/docs claim not checked in source;
"(inferred)" = reasoning, not read.

## Identity & license

Stars and last-commit dates are as of 2026-11-26. "Last commit" is the newest commit on the default branch.

| Project (brief name) | Repo                                                                                                                                                                                                                                                                                                                        | HEAD SHA       | License at HEAD                                                                                                                                                                                                 | Last commit                      | Stars | Stack                                   | Relevance                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Paseo                | [getpaseo/paseo](https://github.com/getpaseo/paseo)                                                                                                                                                                                                                                                                         | `74c33b03d34f` | Apache-2.0 with a preamble carving out third-party components (GitHub reports `NOASSERTION`); same file in `packages/{cli,client,plugin}`                                                                       | 2026-11-26                       | 25.7k | TS daemon + Expo + Electron + CLI       | **High** – closest architectural peer (daemon + desktop/mobile/web/CLI, E2EE relay)                                              |
| Orca                 | [stablyai/orca](https://github.com/stablyai/orca)                                                                                                                                                                                                                                                                           | `aa7e2b6f06ba` | MIT (© Lovecast Inc.)                                                                                                                                                                                           | 2026-11-26                       | 140k  | TS Electron + mobile + `cloud/`         | **High** – bots, remote server, SSH, CI-to-agent                                                                                 |
| Agent Orchestrator   | [OrchestratorInc/agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator) (the old `ComposioHQ/agent-orchestrator` URL redirects here)                                                                                                                                                                    | `e768bd2533c5` | Apache-2.0 (root); see deep dive for `private/ao-cloud`                                                                                                                                                         | 2026-11-26                       | 15.2k | TS backend/frontend + mobile            | **High** – fleet supervision, CI/PR loop                                                                                         |
| Emdash               | [generalaction/emdash](https://github.com/generalaction/emdash) ("Emdash Classic")                                                                                                                                                                                                                                          | `c8769892fd61` | Apache-2.0 (© General Action, Inc.)                                                                                                                                                                             | 2026-11-23                       | 6.3k  | TS Electron                             | **High** – SSH remote, issue integrations                                                                                        |
| Jean                 | [coollabsio/jean](https://github.com/coollabsio/jean)                                                                                                                                                                                                                                                                       | `aeee6b5996d9` | Apache-2.0                                                                                                                                                                                                      | 2026-11-26                       | 1.4k  | Tauri + `src-server` headless           | **High** – headless server mode                                                                                                  |
| Nimbalyst            | [nimbalyst/nimbalyst](https://github.com/nimbalyst/nimbalyst) (successor of [stravu/crystal](https://github.com/stravu/crystal), MIT, last commit 2026-02-26)                                                                                                                                                               | `f67c92302aa8` | MIT (© Nimbalyst Inc.)                                                                                                                                                                                          | 2026-11-26                       | 2.1k  | TS Electron                             | Medium – visual artifacts/editors; telemetry check                                                                               |
| OpenChamber          | [openchamber/openchamber](https://github.com/openchamber/openchamber)                                                                                                                                                                                                                                                       | `fd3ace1364ea` | MIT; `packages/ui/src/lib/ghostty/LICENSE-T3CODE` shows it vendors T3 Code code                                                                                                                                 | 2026-11-26                       | 13.3k | TS (OpenCode-based) web/desktop/VS Code | **High** – web/mobile UI for OpenCode, self-hostable relay                                                                       |
| Frink                | [benord-labs/frink](https://github.com/benord-labs/frink)                                                                                                                                                                                                                                                                   | `a43eef63c6c4` | MIT                                                                                                                                                                                                             | 2026-11-26                       | 64    | TS Electron + mobile + relay            | Medium – event-triggered workflows, live activity                                                                                |
| Prometeu             | [prometeucorp/prometeu](https://github.com/prometeucorp/prometeu)                                                                                                                                                                                                                                                           | `2246f9b2d186` | MIT                                                                                                                                                                                                             | 2026-11-26                       | 67    | Rust/Tauri                              | Low – worktrees + diff review; remote supervision needs "Prometeu Cloud" (docs-only); analytics opt-in since v0.34.0 (docs-only) |
| Unstoppable Code     | [unstoppableweb/unstoppable-code](https://github.com/unstoppableweb/unstoppable-code)                                                                                                                                                                                                                                       | `8f186fc0653d` | MIT (© Unstoppable Domains Inc.); README says "desktop and mobile clients are MIT", accounts/Remote Control/cloud chats rely on their hosted services (`HOSTED-SERVICES.md`); no outside PRs                    | 2026-11-26                       | 83    | TS                                      | Low – hosted-dependent; telemetry acknowledged                                                                                   |
| Podium ADE           | [madeinorbit/podium](https://github.com/madeinorbit/podium) (identified via kyrolabs/awesome-ade and arach/awesome-agent-clients, both naming it "Podium ADE"). Not to be confused with [eengelking/podium](https://github.com/eengelking/podium) (MIT, `0acac6f375e4`, a Claude Code fleet console fed by a reporter hook) | `1c7091593027` | Apache-2.0 + NOTICE (© Michael Wirth, Till Felippi and contributors; NOTICE must be preserved on reuse)                                                                                                         | 2026-11-24                       | 54    | TS, Tauri desktop, mobile, VPS          | **High** – cross-harness subagents and agent communication                                                                       |
| Vigla                | [Kilbex/Vigla](https://github.com/Kilbex/Vigla)                                                                                                                                                                                                                                                                             | `bbd19ae2d5a7` | Apache-2.0                                                                                                                                                                                                      | 2026-07-27 (**stale, 4 months**) | 114   | Rust + Tauri                            | Medium (standout) – deterministic audit gate + whole-mission revert                                                              |
| Sillage              | [MarlBurroW/sillage](https://github.com/MarlBurroW/sillage)                                                                                                                                                                                                                                                                 | `14483e3dfda6` | MIT                                                                                                                                                                                                             | 2026-11-26                       | 15    | TS, desktop or self-hosted server       | Medium                                                                                                                           |
| Sculptor             | [imbue-ai/sculptor](https://github.com/imbue-ai/sculptor)                                                                                                                                                                                                                                                                   | `cdd6dc68496d` | MIT (© Imbue, Inc.)                                                                                                                                                                                             | 2026-11-23                       | 286   | Python backend + Electron               | Low – self-described "experimental research preview"; whole-backend-in-Docker recipe                                             |
| Agent of Empires     | [agent-of-empires/agent-of-empires](https://github.com/agent-of-empires/agent-of-empires)                                                                                                                                                                                                                                   | `e5cf0b9f388d` | MIT                                                                                                                                                                                                             | 2026-11-26                       | 4.9k  | Rust, tmux, TUI + web                   | **High** for CMD-09 (Docker sandbox per session)                                                                                 |
| CodexMonitor         | [Dimillian/CodexMonitor](https://github.com/Dimillian/CodexMonitor)                                                                                                                                                                                                                                                         | `dd61b9abd37d` | MIT                                                                                                                                                                                                             | 2026-03-26 (**stale, 8 months**) | 4.4k  | Tauri                                   | Low – Codex-only; remote daemon over Tailscale TCP with an iOS runbook (`docs/mobile-ios-tailscale-blueprint.md`, docs-only)     |
| Sikemux              | [nodelike/sikemux](https://github.com/nodelike/sikemux)                                                                                                                                                                                                                                                                     | `a6ae18d588b3` | MIT                                                                                                                                                                                                             | 2026-11-26                       | 49    | Rust                                    | Low – "project chief" routing across hosts, "mods" (docs-only)                                                                   |
| Cezar                | [open-mercato/cezar](https://github.com/open-mercato/cezar)                                                                                                                                                                                                                                                                 | `61377b6237f6` | MIT (root and `packages/cezar/LICENSE`)                                                                                                                                                                         | 2026-11-26                       | 1.2k  | TS desktop + npm headless               | Low–Medium – responsive web, usage & cost, automations calendar (docs-only); promotes a paid cloud sandbox                       |
| PandaCode            | [aicodeking/pandacode](https://github.com/aicodeking/pandacode)                                                                                                                                                                                                                                                             | `f8378a31b614` | **Custom "MIT with an attribution requirement"** (GitHub: `NOASSERTION`): a fork used commercially or released publicly must state "This is a fork of PandaCode" with a link in README and a user-visible place | 2026-11-26                       | 1.5k  | Rust/Tauri + mobile + relay             | Medium (standout) – account pools (AUT-07), schedules, ACP catalog                                                               |
| Alethe               | [Kc1t/alethe-agents](https://github.com/Kc1t/alethe-agents)                                                                                                                                                                                                                                                                 | `0acefe82f741` | **AGPL-3.0** (strong copyleft; do not copy code into MIT CMDeck)                                                                                                                                                | 2026-11-08                       | 1.2k  | TS desktop                              | Low – PTY workspace, cross-agent MCP config manager (docs-only); behavioural reference only                                      |

Ambiguous names resolved: "Orca" ≠ echoVic/orca-agent (DeepSeek terminal agent); "Emdash" ≠ emdash-cms/emdash (CMS);
"Frink" ≠ antonellof/frink (GGUF engine); "Sculptor" ≠ sculptor/sculptor (DDD codegen); "Sillage" ≠ illlyy/Sillage
(Android Codex client); "Alethe" ≠ Aletheore/Aletheore (audit CLI); "CodexMonitor" = Dimillian's (the others are small
usage widgets). "Jean" was not findable by GitHub search; the repo was confirmed directly (`gh repo view coollabsio/jean`).

## Directories (§7.8)

| Directory                                                                                 | Exists                                                                                                                 | HEAD / last commit        | License                    | Size           | Maintained?         | Accuracy notes                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------- | -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ahmadyan/awesome-agentic-ides](https://github.com/ahmadyan/awesome-agentic-ides)         | Yes (0 stars)                                                                                                          | `4244283b032f` 2026-10-06 | CC0-1.0                    | 36 repo links  | Slow (7 weeks idle) | Sample of 15 links: 0 dead, 0 renamed. Still links `superset-sh/superset`, which now redirects to `ParadevAI/Paradev`.                                                                                                 |
| [arach/awesome-agent-clients](https://github.com/arach/awesome-agent-clients)             | Yes (3 stars)                                                                                                          | `117c8b8ecf2f` 2026-11-16 | CC0-1.0                    | 918 repo links | Yes                 | Sample: 2/15 renamed (`ertygiq/agent-trace`→`olexvel/agent-trace`, `sahil87/run-kit`→`sahil87/hexokit`). Lists `wandb/catnip`, which is now a **404**. Star counts in entries are stale (Podium shown ★22, actual 54). |
| [1shiharat/awesome-agent-clients](https://github.com/1shiharat/awesome-agent-clients)     | Yes (21 stars)                                                                                                         | `28b32cdcf76f` 2026-11-25 | CC0-1.0                    | 744 repo links | Yes                 | Sample: 0 dead, 0 renamed. Broadest list; mostly agent clients, not ADEs.                                                                                                                                              |
| [erson/awesome-agent-orchestrators](https://github.com/erson/awesome-agent-orchestrators) | **Renamed** to [erson/orchestration-atlas](https://github.com/erson/orchestration-atlas) (old URL redirects; 12 stars) | `2fa89578f30e` 2026-11-26 | **None** (no LICENSE file) | 647 repo links | Yes (daily)         | Sample: 0 dead. Now a catalog plus HTML explorer with activity metadata; the most useful of the five for maintenance signals.                                                                                          |
| [kyrolabs/awesome-ade](https://github.com/kyrolabs/awesome-ade)                           | Yes (33 stars)                                                                                                         | `028f77423546` 2026-11-11 | CC0-1.0                    | 115 repo links | Yes                 | Sample: 0 dead. Most on-topic; has an activity column (e.g. Podium "🟢 Active"). Still links `superset-sh/superset`.                                                                                                   |

Method: link counts are unique `github.com/owner/repo` URLs in each README. 15 links per directory were sampled with
`gh api repos/{r}`. This is a spot check, not a full crawl.

Additions found through the directories (cap 5, only ones materially relevant to open wishlist gaps):

| Project                     | Repo / SHA                                                                     | License    | Last commit                                               | Why it matters                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| container-use               | [dagger/container-use](https://github.com/dagger/container-use) `2e43e625e952` | Apache-2.0 | 2026-08-12 (3.5 months idle; README badge "experimental") | Per-agent container + git branch, exposed **as an MCP server** (`container-use stdio`). Direct prior art for CMD-09. Needs the Dagger engine.                                                                                                            |
| Happy                       | [slopus/happy](https://github.com/slopus/happy) `4ef7e4c76e8f`                 | MIT        | 2026-11-26 (24.9k stars)                                  | E2EE mobile/web client for Claude Code/Codex with `packages/happy-server`, `packages/happy-server-self-host` and a Cloudflare-Worker push server (`packages/happy-push-server`). Prior art for CMD-02 (a self-hosted relay and push without T3 Connect). |
| Paradev (formerly Superset) | [ParadevAI/Paradev](https://github.com/ParadevAI/Paradev) `09ce262b1cfb`       | MIT        | 2026-11-26 (16.7k stars)                                  | Large ADE peer: worktree per task, review, browser previews, CLI and MCP server (directory text, docs-only). Not inspected further; overlaps T3 heavily.                                                                                                 |
| Catnip                      | `wandb/catnip`                                                                 | –          | –                                                         | Listed by arach as "containerized worktree sandboxes + iOS", but the repo is **404**. Recorded only as a directory-accuracy defect.                                                                                                                      |

Out of scope here: §7.9 also names Hermes Agent, OpenClaw, CodexBar, Letta, OpenHands and Symphony. These are libraries
and agents rather than ADEs and belong to the sibling library agent; they are not covered in this note.

## Deep dives

Paths are relative to each repo at the SHA in the identity table. Deep dives for the first nine projects
came from four read-only sub-agent passes (about 35–40 tool calls each); the lead agent read PandaCode,
Vigla and Sculptor. CMDeck comparisons in these passes were **keyword greps, not code reads**, so every
"verify" below stays open. Two facts were confirmed by other audit agents and override the deep dives:
CMDeck **has** durable workflows with failed-step-only retry (`apps/server/src/workflows`), scheduled tasks
with webhooks (no cron syntax), a Playwright preview with human takeover, `UsageLimitRecoveryWorker`, batched
diff comments (CMX-05) and second-model review. CMDeck **lacks** a memory store, Web Push/service worker,
Docker or Windows sandboxing, and a hash-chained audit log.

### Paseo (getpaseo/paseo @ `74c33b0`)

**Architecture.** Node daemon (`packages/server`) spawns providers (Claude Agent SDK, Codex app-server,
Copilot ACP, OpenCode, Pi) and serves WebSocket plus the web UI. One Expo codebase for iOS/Android/web
(`packages/app`), Electron desktop that supervises the daemon, Commander CLI, SDK (`packages/client`), wire
schemas (`packages/protocol`). File persistence under `$PASEO_HOME`. Transports: direct WS, SSH to a running
daemon, Tailscale, or an optional E2EE relay (`packages/relay`, a Cloudflare Durable Object worker). Terminals
run in a detached worker that survives daemon restarts (`docs/terminal-worker.md`). Plugins run as
subprocesses (`server/plugins/`). The "Hub" (GitHub/Linear/Slack/Discord/webhook triggers) is a separate
service; only its daemon side is in this repo (`server/hub/`).

**Key evidence.**

- E2EE relay: `packages/relay/src/secure-channel.ts` (`openClientSecureChannel`, `openDaemonSecureChannel`),
  `noise/*` (Noise `NK_25519_ChaChaPoly_SHA256`, counter nonces), `protected-records.ts`; relay endpoint
  configurable via `daemon.relay.{endpoint,publicEndpoint,useTls}`; downgrade refused by
  `requireProtectedSecurity`; pairing key in URL fragment. Tests: `noise/noise.test.ts`,
  `secure-channel.test.ts`, `protected-records.test.ts`, `daemon-e2e/relay-transport.e2e.test.ts`.
- Fleet across daemons: `server/connected-hosts/{link,session,flow-control}.ts`; grants intersected per hop,
  second hop refused; `hosts.e2e.test.ts`.
- Agent tool catalog: `agent/tools/paseo-tools.ts` `createPaseoToolCatalog`, incl. `create_heartbeat` /
  `delete_heartbeat` (cron, timezone, `maxRuns`, `expiresIn`, bound to `callerAgentId`) over
  `server/schedule/{cron,service,store}.ts`.
- Second-opinion skills installed into harness skill dirs: `skills/paseo-committee/SKILL.md`,
  `skills/paseo-advisor/SKILL.md`, via `server/orchestration-skills/` `createOrchestrationSkills`.
- Opt-in resume after crash (`agents.resumeOnStartup`, `docs/agent-lifecycle.md`); idle provider release
  (`idle-runtime-cleanup/`, `ensureAgentLoaded()`).
- Worktrees: `server/auto-archive-on-merge/index.ts` `setupAutoArchiveOnMerge`, `archive-if-safe.ts`
  (tests `archive-if-safe.test.ts`, `behavior.test.ts`); `plugins/worktree-include/server/copy.ts`.
- Docker: `docker/base/Dockerfile` runs the **whole daemon** as one non-root container; no per-agent sandbox.
- `SECURITY.md`: setup scripts from another repo's checkout are not run until approved.

**Privacy.** No analytics SDK found. Push goes to Expo (`server/push/push-service.ts` `EXPO_PUSH_URL`;
payload encryption not checked). Default relay `relay.paseo.sh` (off by default for new installs).
**License.** Apache-2.0 with a third-party carve-out; reuse needs attribution and the patent clause applies.

**Borrow.** (1) Relay protocol details for CMD-02: Noise NK records, downgrade pin, replay rejection, key in
URL fragment, configurable endpoint; compare against CMDeck `packages/shared/src/socketE2ee.ts`.
(2) Detached terminal worker plus opt-in resume for INF-04. (3) Self-heartbeat tool (AUT-03) and committee
skill (NEW-A08).

### OpenChamber (openchamber/openchamber @ `fd3ace1`)

**Architecture.** UI and orchestration layer **for OpenCode only**. `packages/web/server` is a Node server
with about 60 `lib/*` modules (relay, tunnels, quota, scheduled tasks, workflows, session goal, session lead,
agent memory, routing, guests) proxying the OpenCode SDK. Clients: shared React UI (`packages/ui`),
Electron, a VS Code extension, a Capacitor shell for iOS/Android (`packages/mobile`), an iframe guest SDK
(`packages/sdk`). JSON files plus a SQLite message-search index. Vendors T3 Code terminal code
(`packages/ui/src/lib/ghostty/LICENSE-T3CODE`).

**Key evidence.**

- E2EE relay: `lib/relay/{service,host-client,tunnel-host,e2ee,identity,key-store,provenance}.ts`
  (ECDH P-256 + HKDF + AEAD); `DEFAULT_RELAY_URL` overridable and lockable via enterprise `policy.json`
  (`readEnterprisePolicy`). Tests `e2ee.test.js`, `cross-compat.test.js`, `host-client.test.js`.
- Tunnel providers: `lib/tunnels/providers/{cloudflare,ngrok,tailscale}.ts`, `tunnel-auth.ts`.
- Pairing v2: `lib/client-auth/{pairing,remote-clients}.ts` (single-use QR, token per device, revocation,
  scope local/LAN/anywhere). Tests `pairing.test.js`, `remote-clients.test.js`.
- Session goals: `lib/session-goal/{audit,runtime,continuation}.ts` (`buildJevAuditRequest`) — an
  auditor model keeps a session working until the objective is met; server-side. Tests present.
- Leads: `lib/session-lead/{runtime,handover,brief-store}.ts` — owner sessions that delegate and reject
  reports without proof.
- Agent memory: `lib/agent-memory/{runtime,dreaming,threat-patterns}.ts` (`createMemoryDreaming`,
  `looksLikeInjection`). Tests `dreaming.test.js`, `threat-patterns.test.js`.
- Folder trust: `lib/opencode-trust/{assessment,store,fetch-guard}.ts` — fingerprints what repo config would
  run (plugins, MCP servers, `{env:}`/`{file:}` substitution) and re-asks when it changes.
- Routing: `lib/routing/{classifier,runtime,jev}.ts` (`CLASSIFIER_SOURCES` incl. third-party endpoints).
- Quota fetchers for about 30 providers: `lib/quota/providers/*`.
- Guest panels: `lib/guests/{frame-grants,grant-scope,oauth}.ts` — tokens never reach the iframe.

**Privacy.** No telemetry (`work-status/telemetry.ts` is local stats only). Default relay
`relay.openchamber.dev`; sealed push payloads (`notifications/push-seal.ts`). The routing classifier and
goal auditor send prompt text to third parties unless set to off/custom. **License.** MIT; check provenance of
anything under `lib/ghostty/` (originally T3's).

**Borrow.** (1) Folder trust fingerprinting (NEW-A01). (2) Session goals as an AUT-04 / AGT-03
implementation reference, with the auditor defaulting to a local model. (3) Lockable `relayUrl` and the
Tailscale Serve tunnel provider for CMD-02/03.

### Orca (stablyai/orca @ `aa7e2b6`)

**Architecture.** Electron app with main-process services in `src/main/*` (runtime, bots, automations, ssh,
git, github, linear, browser, acp, rate-limits, telemetry); headless `orca serve` (`src/main/orcad`,
`src/main/managed-server`); Expo mobile (`mobile/`) over E2EE RPC (`src/shared/remote-runtime/e2ee/*`);
`cloud/` holds relay, push gateway and contracts (deploy config in a private repo). The Slack/Linear/GitHub
bot connector is **hosted** (`src/main/connector-cloud/connector-origin.ts` `DEFAULT_CONNECTOR_ORIGIN`,
long-poll client `ConnectorPollClient`).

**Key evidence.**

- Orchestration: `src/shared/orchestration/orchestration-rpc-contract.ts` (`orchestration.send/ask/
  gateCreate/workerStart/federation*`), `src/cli/orchestration/*` — typed mailbox (`worker_done`,
  `question`, `escalation`, `heartbeat`), decision gates, coordinator woken on reports. Labelled experimental.
- Per-workspace environments by recipe: `skills/orca-per-workspace-env/SKILL.md`,
  `skill-guides/orca-per-workspace-env/references/docker-ssh.md`,
  `src/main/ipc/runtime-environments/managed-orcad/runtime-environment-recipe-vm-wake.ts`
  (create/suspend/resume/destroy scripts returning a pairing URL or SSH details).
- CI: `src/main/github/client/check/{get-pr-checks,rerun-pr-checks}.ts`,
  `src/main/bots/bot-template-skills/ci-failure-triage.ts` (real/flaky/infra triage prompt).
- Accounts: `src/main/rate-limits/providers/claude/claude-oauth-usage-request.ts`,
  `src/shared/agent-accounts/claude/claude-account-switch-settings.ts` (manual switch, no auto-rotation found).
- Design mode: `src/renderer/src/components/browser-pane/annotate/*`. Computer use:
  `native/computer-use-{macos,linux}`, `src/main/computer/*` (not read in depth).
- Telemetry: PostHog behind a consent banner (`src/main/telemetry/consent.ts` `resolveConsent`, honours
  `DO_NOT_TRACK`).

**License.** MIT (whole repo incl. `cloud/`). **Borrow.** (1) Recipe contract for CMD-09/10 environments,
handing a pairing URL to CMDeck peer links. (2) Typed mailbox and wake-on-report for AGT-09. (3) Outbound
long-poll connector pattern for MSG-01..03 (self-hosted, not Orca's cloud).

### Agent Orchestrator (OrchestratorInc/agent-orchestrator @ `e768bd2`)

**Architecture.** Go daemon (`backend/`) on loopback (unauthenticated) plus an optional authenticated LAN
listener for mobile (`backend/internal/mobilebridge/*`); SQLite. Electron frontend, React Native app
(`packages/mobile`). Ports-and-adapters: about 50 harness adapters, `runtime/{conpty,tmux}`,
`scm/{github,gitlab}`, `tracker/*`; observers (`observe/{scm,trackerintake,automations,usage,reaper}`) feed
`lifecycle/` reactions. Paid "AO Cloud" behind `contracts/cloud/openapi.yaml` (client only).
`private/ao-cloud` is a gitlink to `Untrivial-ai/ao-cloud` with `update = none`: content and license unknown,
likely closed (inferred).

**Key evidence.**

- PR reaction engine: `backend/internal/lifecycle/reactions.go` (`ApplyPRObservation`, `pendingNudge`,
  `reviewMaxNudge=3`), `observe/scm/observer.go` (ETag polling, `rateLimitCooldown`); tests
  `observe/scm/observer_test.go`, `lifecycle/manager_test.go`. Persisted dedupe; CI nudges wait while the
  agent sits at needs-input; conflicts are urgent.
- Reviewer planner per head SHA: `backend/internal/review/planner.go` (`Plan`, `PlanAuto`,
  `latestRunsByPRAndSHA`); drafts excluded.
- Tracker intake: `observe/trackerintake/observer.go` (opt-in, backoff).
- Container cleanup: `adapters/container/dockerreap/reap.go` (label `ao.session=<id>`, opt-out
  `ao.spare=true`, fail-safe), `reap_test.go`.
- Remote: `docs/adr/0004-cloudflare-tunnel-for-remote-mobile-access.md` (states Cloudflare sees plaintext),
  `mobilebridge/tailscaleserve.go` (tailnet only, never funnel), `mobilebridge/pairingcodes.go`. Auth is a
  rotating bearer password, no E2EE.
- Cues refuse delivery while a permission prompt is pending: `service/cue/*` (`sessionMessageable`).
- Conductor import reads the DB with `immutable=1`: `skillassets/using-ao/commands/conductor.md`.

**Privacy.** PostHog and Sentry **on by default** in release builds and not anonymous when signed in
(`docs/telemetry.md`). **License.** Apache-2.0 (root); `private/ao-cloud` excluded.
**Borrow.** (1) Reaction engine dedupe/deferral rules for CMD-15/AUT-05. (2) `dockerreap` label convention for
CMD-09 cleanup. (3) Transport preference order (LAN, then Tailscale, then tunnel) and the honest tunnel ADR
wording for CMD-04.

### Emdash (generalaction/emdash @ `c876989`)

**Architecture.** Electron desktop coordinates; a per-user workspace server executes
(`apps/workspace-server`), listening on a 0700 Unix socket (no TCP port) with each subsystem in a supervised
child process. Remote machines are reached by SSH (`ssh2`) forwarding a channel to that socket
(`docs/client-connection.md`). Wire schemas in `packages/wire`. SQLite + Drizzle. Plugins: 38 agent adapters,
13 issue trackers, GitHub/GitLab PRs (`packages/plugins/src/{agents,issues,pull-requests}/impl`).

**Key evidence.**

- Daemon: `apps/workspace-server/src/daemon/{start,stop,probe,lock,pid-file}.ts` + tests; remote install
  `core/services/hosts/node/workspace-server/provision/installer.ts` (`buildWorkspaceServerInstallCommand`)
  pipes `curl https://releases.emdash.sh` to `sh` **without** passing the supported `--sha256`.
- Session reconciliation: `services/session-lifecycle/node/session-lifecycle.ts` (`createSessionLifecycle`),
  `session-intents/api/schemas.ts` (active/suspended, `reconcile-failed`).
- Queued prompt rules incl. "outcome unknown": `CONTEXT.md` (docs-only).
- Automations on the remote host in a worktree pool: `packages/core/src/runtimes/automations/api/deployment.ts`
  (`automationScheduleSchema{expr,tz}`), `node/scheduling/{cron,scheduler}.ts`.
- Draft diff comments as hidden context: `draft-comments-store.ts`, `draft-comments-context.ts`
  (`appendDraftCommentsContext`).
- SSH preview port forwarding: `features/preview-servers/node/port-forward-tunnel.ts` (tries `127.0.0.1` and `::1`).
- Artifact reclaim: `CONTEXT.md` "Workspace artifacts" (`git clean -ndX` minus `.env*`, `cleanArtifacts`).

**Privacy.** PostHog **on by default**; after sign-in `identify(username, userId, email)` ties GitHub
identity to the install (`src/main/lib/telemetry.ts`). **License.** Apache-2.0.
**Borrow.** (1) SSH-to-Unix-socket remote access (CMD-12): no exposed port, SSH is the only auth — but pin
installer hashes. (2) Session reconciliation with "outcome unknown" for INF-04 / CHT-05. (3) `::1` fallback in
preview port forwarding.

### Jean (coollabsio/jean @ `aeee6b5`)

**Architecture.** Rust core (`jean-core`: state, commands, storage, agent backends, terminals, HTTP/WS),
Tauri desktop (`src-tauri`), headless Axum server with embedded web UI (`src-server`,
`docs/headless-server.md`). Desktop and web share `jean-core/src/http_server/dispatch.rs`. About 13 CLI
backends. JSON/JSONL files plus git refs for checkpoints. Built-in MCP server (`jean_mcp_core.rs`).

**Key evidence.**

- Headless auth: `jean-core/src/http_server/{server,auth}.rs` (`generate_token`, constant-time
  `validate_token`, `token_required` can be disabled — risky on public binds).
- SSH tunnel with host-key pinning: `src-tauri/src/ssh_tunnel/{supervisor,hostkey,secrets}.rs`
  (`SshTunnelSupervisor`), token in OS keychain, backoff 1–30 s.
- Delegation with depth counter: `jean-core/src/chat/delegation.rs`, `jean_mcp_core.rs` (`current_depth`).
- "Mr. Robot" issue auto-fix: `jean-core/src/auto_fix/{scheduler,types}.rs` (`AUTO_FIX_MAX_ATTEMPTS = 3`,
  label filters, active hours, dry-run, `rate_limited_until`); status lost on restart.
- GitHub quota reserve: `gh_cli/quota.rs` (`RESERVE_DIVISOR`, separate REST/GraphQL budgets),
  `projects/pr_status.rs` (304 responses).
- Detached Claude process: `jean-core/src/chat/detached.rs`, `chat/tail.rs` (tails JSONL).
- Multi-model fan-out: `jean-core/src/projects/multi_model_prompt.rs`.
- Git-ref checkpoints: `projects/checkpoints.rs` (`refs/jean/checkpoints/<id>`).
- Removed CLIProxyAPI over account-ban risk: `opinionated/cliproxyapi.rs`.

**Privacy.** No telemetry packages in the web front end (Rust crates not fully checked). **License.**
Apache-2.0. **Borrow.** (1) GitHub quota reserve (NEW-A06). (2) Label-driven auto-fix with preview and
attempt cap (NEW-A07). (3) Multi-model fan-out (NEW-A04).

### Nimbalyst (nimbalyst/nimbalyst @ `f67c923`)

**Architecture.** Electron + Lexical runtime with WYSIWYG editor extensions (`packages/extensions/*`:
mockuplm, excalidraw, csv, datamodellm, crew, automations, memory). Native iOS/Android. Sync, mobile and
headless features need the **hosted** `wss://sync.nimbalyst.com` (Stytch auth; server not in repo). Headless
node `packages/node`; `packages/cloudflare-sandbox` deploys it into the user's own Cloudflare account.

**Key evidence.**

- Telemetry: `packages/electron/src/main/services/analytics/AnalyticsService.ts` (hard-coded PostHog key),
  `utils/store.ts` (`isAnalyticsEnabled` defaults true, "fail open"); `nimbalyst_session_start` still sent
  after opt-out. **Anti-pattern for CMD-01.**
- Cloudflare sandbox: `packages/cloudflare-sandbox/src/{index,management}.ts`, `container/Dockerfile`
  (`enableInternet = false`, `allowedHosts`, image pinned by digest; README admits a symlink race).
- Crew (long-running agents with schedule, journal, token ledger): `packages/extensions/crew/src/backend.ts`
  (`CrewRuntime`), alpha.
- Automations as markdown with YAML frontmatter: `packages/extensions/automations/src/index.tsx`.

**License.** MIT. **Borrow.** (1) Egress-off-by-default with host allowlist and digest-pinned image for
CMD-09. (2) Crew as a reference for AGT-02. Not recommended as a code source because of its telemetry design.

### Agent of Empires (agent-of-empires/agent-of-empires @ `e5cf0b9`)

**Architecture.** One Rust binary `aoe`: TUI, CLI, `aoe serve` HTTP API and a React web dashboard. Each
agent runs in tmux, or in a detached ACP runner that survives daemon crashes
(`docs/development/internals/structured-view.md`). **Linux and macOS only** (README), so tmux parts do not
carry over to Windows hosts.

**Key evidence — per-session container sandbox (CMD-09).** `src/containers/runtime_base.rs` `create_args`
(inline test `create_args_render_mount_options_per_runtime`), `src/session/instance/container.rs`,
`tests/e2e/sandbox.rs`, `docs/guides/sandbox.md`. Docker, Podman, Apple Container. Project at `/workspace`
read-write with `.git/config`, `config.worktree` and `hooks` overlaid **read-only** (blocks host-side hook
planting); `~/.ssh` only if `mount_ssh`; per-session agent config store `sandbox-v2/<id>`; one shared Claude
`.credentials.json` (refresh-token rotation); secrets via env-file (`docker_env_args`); `sandbox.network`
→ `--network` (`none` drops port mappings); `--cpus`, `-m`, caps, `security_opt`; `volume_ignores`. Image
`ghcr.io/agent-of-empires/aoe-sandbox:<version>`. Weaknesses: no `USER` in `docker/Dockerfile` (root,
inferred), about 12 CLIs installed via `curl | bash`, no egress allowlist, Apple Container loses read-only
mounts.

**Other.** Detached runners with registry `acp-workers/<id>.json`, `setsid` process groups, 48-hour self
shutdown (INF-04, docs-only). `aoe serve --remote`: Tailscale Funnel → named Cloudflare tunnel → quick
tunnel; auth `none` refused unless `--behind-proxy`; token rotates every 4 hours (docs-only). VAPID Web Push
with suppression rules (60 s cooldown per session, 5 s "waiting" threshold, none while foregrounded) in
`docs/push-notifications.md` (docs-only). Telemetry opt-in. **License.** MIT (LICENSE file confirmed by lead).
**Borrow.** (1) The mount table as the CMD-09 spec. (2) Push suppression rules for NEW-A09. (3) Runner
registry plus watchdog for INF-04.

### Podium ADE (madeinorbit/podium @ `1c70915`)

**Architecture.** `apps/server` (Hono + tRPC, janitor worker) is the single authority; `apps/daemon` runs
on each machine, wraps agent CLIs and streams terminals. Clients: mobile-first web, Expo, Tauri, CLI. SQLite
or Postgres via Drizzle. Daemons pair with single-use codes (ADR 0005, docs-only).

**Key evidence — agent mail (AGT-09).** `apps/server/src/modules/messages/service.ts`
(`MessageDeliveryService`), `mailbox.ts` (`MessageMailbox`), `brakes.ts` (`DeliveryBrakes`,
`WAKE_COOLDOWN_MS` = 10 min, `SPAWN_BUDGET_PER_DAY` = 10; the `service.ts` header still says 3 — drift),
`apps/daemon/src/mail-injector.ts` (nudges injected via the agent's own Stop/PreToolUse hooks),
`packages/commands/src/mail/{stop-nudge,ceiling}.ts` (`HumanCeiling`: agents address only what their human
can see; refusals look like not-found). Server stamps the sender; rows durable before delivery; urgency
fyi / next-turn / interrupt / wake; one reminder then a system notice to the sender; hop limit 5 (header
only, not confirmed in code). About 15 test files under `apps/server/src/modules/messages/`. Cron:
`modules/automations/scheduler.ts` + `scheduler.single-flight.test.ts`.

**Privacy.** Telemetry **on by default** (daily PostHog report via `pulse.meetpodium.com`,
`docs/TELEMETRY.md`). **License.** Apache-2.0 + NOTICE (must be kept). **Borrow.** (1) Brakes (NEW-A02).
(2) Hook-based mail nudges with one reminder. (3) Human-ceiling addressing rule.

### Frink (benord-labs/frink @ `a43eef6`)

**Architecture.** Electron, logic in `src/main/lib/` (flows, mcp, agent-runner, git, permissions, mobile,
webhooks); SQLite + Drizzle; React Native `mobile/` via a self-hostable socket.io `relay/`;
`live-activity-forwarder/` Cloudflare Worker for iOS Lock Screen updates.

**Key evidence.** E2EE phone channel: `src/shared/lib/mobile-channel/index.ts` (+ `index.test.ts`),
`src/main/lib/mobile/relay-host.ts` (`startRelayHost`), `identity.ts` — tweetnacl, desktop key pinned in the
QR, per-session keys, bearer token sent inside the channel, connection caps. Webhooks: relay address is
`sha256(K)`, signatures verified on the desktop, vendor extractors
`src/shared/webhooks/extractors/{linear,shortcut,generic}.ts`, verifiers
`signatures/{standard-webhooks,notion,vendor-hmac,hex-hmac}.ts` with fixtures. Step resume:
`src/main/lib/flows/rerun/{resume-point,carry-on,fan-out-lane-resume,recover-interrupted}.ts`
(`lastUnfinishedNodeRun`; "carry on" resumes the failed attempt's session in place). Keep-awake:
`src/main/lib/power/keep-awake.ts` (+ test).

**Privacy.** Official builds send PostHog (opt-out) and Sentry; webhook relay and Live Activity forwarder
default to Frink-hosted infrastructure; custom flow nodes run unsandboxed. **License.** MIT (confirmed by lead).
**Borrow.** (1) Pinned-key QR pairing with token-inside-channel for CMD-02. (2) Standard Webhooks verifier
and vendor extractors for AUT-06. (3) "Carry on in the same session" as an option on CMDeck's existing
failed-step retry (AGT-06).

### Sillage (MarlBurroW/sillage @ `14483e3`)

**Architecture.** Fastify + WS + node-pty + SQLite (Drizzle) + Claude Agent SDK, Codex and OpenCode bindings;
React PWA (`apps/web`) wrapped by desktop; self-hostable via `Dockerfile`, `deploy/docker-compose.example.yml`,
Helm chart `deploy/helm/sillage`, systemd/launchd templates. Its conversation handoff says it was "inspired by
T3 Code".

**Key evidence.** Check-script gate: `apps/server/src/scheduler/check.ts` (exit 0 wakes with output, exit 10
skips without opening a session; timeout with kill-tree; agent-written scripts need approval). Web Push:
`apps/server/src/push/push-service.ts` (`web-push`). Project-scoped memory shared across worktrees:
`apps/server/src/memory/store.ts` (`projectMemoryDir`, `claudeNativeMemoryDir`). Decisions inbox and
QuickJS webhook filters (`quickjs-emscripten` dependency) are docs-only (`docs/features.md`).
Tailscale Serve auto-setup: `apps/server/src/remote-access/tailscale.ts` (path only).

**Privacy.** No telemetry found; update checker only. **License.** MIT (confirmed by lead).
**Borrow.** (1) Check-script gate as the AUT-02 implementation. (2) Web Push (NEW-A09). (3) Decisions inbox
(NEW-A03).

### Standouts read by the lead

- **PandaCode** (`f8378a3`): `src-tauri/src/account_pool.rs` and `providers/pool.rs` rotate a run across
  pooled Claude/Codex accounts when one hits its limit, copying the harness session file into the next
  account's config folder and resuming with "Continue where you left off." Holds persisted to
  `account-holds.json`; near-limit accounts (≥ 90 %) left between turns. Technically neat, but multi-account
  rotation to evade per-account limits is a likely provider-terms problem, and the license requires a visible
  "fork of PandaCode" notice if code is reused. CMDeck already has `UsageLimitRecoveryWorker` (wait-and-resume)
  for AUT-07. **Do not adopt.**
- **Vigla** (`bbd19ae`, stale since 2026-07-27): deterministic submission audit
  `crates/orchestrator/src/audit/` (`audit_submission`; scorers `test_pass`, `scope`, `regression`, `lint`,
  path-based `security`; tiers Smoke/Standard; `composite::blend_overall`) and whole-mission rollback
  `crates/orchestrator/src/mission_workspace/revert.rs` (`revert_mission`, `revert_merged_mission`: a normal
  revert commit on the target branch after merge, else reset the staging branch to its recorded branch
  point; tests `crates/orchestrator/tests/revert_mission.rs`, `tests/e2e/inbox-verdict-revert.spec.ts`).
  Supervisor output is treated as untrusted and schema-validated (`crates/adapters/supervisor/README.md`).
  Useful because its gate is **deterministic**, consistent with §15's rule that model judgments are not
  security boundaries.
- **Sculptor** (`cdd6dc6`): "custom backend command" — the desktop runs a user command that prints a backend
  URL, and `container/recipes/docker/run-backend.py` runs the whole backend in Docker. Coarse isolation, not
  per thread. One line: a cheap escape hatch for CMD-09, not a design to copy.
- **container-use** (`2e43e62`): per-agent container + branch exposed as MCP tools. Isolation applies only to
  commands the agent routes through those tools; the harness's native shell/edit tools still act on the host
  unless disabled (inferred from the MCP design). Not an enforced boundary.
- **Happy** (`4ef7e4c`): `packages/happy-server-self-host` runs the E2EE sync server with embedded PGlite and
  local file storage (`happy server`), plus a Cloudflare-Worker APNs/FCM push server. Prior art for a
  self-hosted relay and push without T3 Connect (CMD-02).

## Findings mapped to wishlist IDs

Classification uses brief §7.9: **In CMDeck** (confirmed by other agents), **Verify** (deep dive grep only),
**Alternative** (another implementation of a selected/required feature), **NEW-A..** (see next section),
**Incompatible**. Full per-row evidence is in `competitive-ades.csv`.

| ID              | What competitors offer            | Best reference (repo: file)                                                                                                                                                                                      | CMDeck status                                                                                           | Classification / recommendation                                                                                                                                                                                                           |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMD-01          | Telemetry designs                 | Orca `telemetry/consent.ts` (consent banner); Nimbalyst `AnalyticsService.ts` (opt-out with retention ping); Emdash, AO, Podium, Frink on by default                                                             | CMDeck removes telemetry                                                                                | Anti-patterns only. Do not port any telemetry code from these repos.                                                                                                                                                                      |
| CMD-02          | Self-hostable E2EE relay          | Paseo `packages/relay` (Noise NK, downgrade pin, configurable endpoint); OpenChamber `lib/relay` (lockable `relayUrl`); Frink `mobile-channel` (pinned key in QR); Happy self-host server                        | Verify `packages/shared/src/socketE2ee.ts` for replay protection and downgrade pinning                  | Alternative. Paseo is the strongest protocol reference (Apache-2.0); Happy shows packaging a self-hosted sync server.                                                                                                                     |
| CMD-03          | Tailscale Serve automation        | AO `mobilebridge/tailscaleserve.go` (tailnet only, never Funnel); OpenChamber `tunnels/providers/tailscale.ts`; Sillage `remote-access/tailscale.ts`                                                             | Present per AO deep dive grep; verify                                                                   | Alternative. AO's "never Funnel" rule fits CMDeck's privacy stance.                                                                                                                                                                       |
| CMD-04          | Cloudflare tunnel trade-offs      | AO `docs/adr/0004-…` (Cloudflare sees plaintext); OpenChamber cloudflare provider; AoE fallback chain                                                                                                            | CMDeck cloudflared lives in `apps/server/src/cloud/*` (T3 Connect code); verify                         | Alternative. Adopt the transport order LAN → Tailscale → tunnel and the plaintext warning; keep Access mandatory.                                                                                                                         |
| CMD-09          | Per-thread Docker sandbox         | AoE `src/containers/runtime_base.rs` `create_args`; AO `dockerreap/reap.go`; Nimbalyst `cloudflare-sandbox` (egress allowlist, digest pin); Orca env recipes; container-use; Sculptor/Paseo (whole-backend only) | **Absent** (confirmed)                                                                                  | Alternative — AoE's mount table + AO's label reaper + Nimbalyst's egress-off default together form the spec. Write it in TS; AoE is MIT so porting is allowed with attribution. AoE is Linux/macOS; Windows needs Docker Desktop testing. |
| CMD-10          | Windows Sandbox                   | None of the 20 projects                                                                                                                                                                                          | **Absent**                                                                                              | No reference found.                                                                                                                                                                                                                       |
| CMD-12 / INF-01 | Remote execution on user machines | Emdash SSH → Unix socket; Jean SSH tunnel with host-key pinning; Paseo connected hosts (grant intersection, no second hop); Orca SSH/remote server; Podium server+daemons                                        | CMDeck peer links + `packages/ssh/src/tunnel.ts`                                                        | In CMDeck. Verify host-key pinning and multi-hop rules against Jean and Paseo.                                                                                                                                                            |
| CMD-13          | Tray / keep awake                 | Emdash `host/tray.ts`; Frink `power/keep-awake.ts` (battery release)                                                                                                                                             | Tray present (`apps/desktop/src/ipc/methods/tray.ts`); `apps/server/src/background/KeepAwake.ts` exists | In CMDeck. Frink's 10 % battery release is a small improvement to check.                                                                                                                                                                  |
| CMD-14          | Batched diff comments             | Orca `diff-comments/*`; Emdash `draft-comments-context.ts`                                                                                                                                                       | **In CMDeck** (CMX-05)                                                                                  | No action.                                                                                                                                                                                                                                |
| CMD-15 / AUT-05 | CI failure → agent; PR monitoring | AO `lifecycle/reactions.go` (dedupe, needs-input deferral, nudge cap); Jean `gh_cli/quota.rs`; Orca `ci-failure-triage.ts`                                                                                       | In CMDeck (PR watch, `ci_logs`/`ci_rerun`); dedupe/deferral depth: verify                               | Alternative hardening: AO rules. Quota reserve is NEW-A06.                                                                                                                                                                                |
| CMD-16 / DEV-01 | Second-model review               | AO `review/planner.go` (per head SHA); Paseo committee skill; Jean CodeRabbit CLI                                                                                                                                | **In CMDeck**                                                                                           | Alternative: per-SHA review state. Committee is NEW-A08.                                                                                                                                                                                  |
| CMD-17          | Worktree lifecycle                | Paseo auto-archive + `.worktreeinclude`; Emdash artifact reclaim                                                                                                                                                 | Verify                                                                                                  | NEW-A05.                                                                                                                                                                                                                                  |
| CMD-21 / INF-12 | Import from other ADEs            | AO `legacyimport/*`, Conductor import with `immutable=1`                                                                                                                                                         | Verify                                                                                                  | Alternative: open foreign DBs read-only/immutable.                                                                                                                                                                                        |
| CMD-22 / CMD-23 | Mobile / responsive web           | Jean `Mobile*` components; OpenChamber Capacitor shell; Paseo single Expo codebase; AoE/Sillage PWA                                                                                                              | CMDeck targets the official T3 app + PWA                                                                | Alternative only. Web Push is NEW-A09.                                                                                                                                                                                                    |
| AGT-01          | Task Runner / issue intake        | AO `trackerintake/observer.go`; Jean `auto_fix/scheduler.rs`                                                                                                                                                     | Triage present; verify                                                                                  | NEW-A07 (issue-driven automation).                                                                                                                                                                                                        |
| AGT-02          | Persistent bots                   | Nimbalyst Crew (`CrewRuntime`); Orca Bots (hosted connector — incompatible)                                                                                                                                      | Verify against Kiro audit                                                                               | Alternative: Crew's file journal + budget ledger.                                                                                                                                                                                         |
| AGT-03 / AGT-07 | Conductor / work ledger           | OpenChamber leads + session goals; Podium issue tree; Orca mailbox + gates; Vigla supervisor + deterministic audit                                                                                               | Verify                                                                                                  | Alternative. Prefer deterministic gates (Vigla) over model-only auditors.                                                                                                                                                                 |
| AGT-04          | Parallel subagents                | Paseo tool catalog; Orca workers; Jean depth counter                                                                                                                                                             | **In CMDeck** (orchestration MCP)                                                                       | No action; consider a depth limit (see NEW-A02).                                                                                                                                                                                          |
| AGT-06          | Selective workflow retry          | Frink `flows/rerun/*` (carry-on in same session)                                                                                                                                                                 | **In CMDeck** (failed-step-only retry, confirmed)                                                       | Alternative: optional "carry on in the failed session" mode. Low priority.                                                                                                                                                                |
| AGT-09          | Agent channels                    | Podium mail (`MessageDeliveryService`, hook nudges, `HumanCeiling`, `DeliveryBrakes`); Orca typed mailbox                                                                                                        | `t3_thread_send` exists; channels: verify                                                               | Alternative: Podium is the strongest reference (Apache-2.0 + NOTICE). Brakes are NEW-A02.                                                                                                                                                 |
| AUT-01          | Cron jobs                         | Paseo `schedule/cron.ts`; Emdash `automationScheduleSchema{expr,tz}`; Podium single-flight scheduler                                                                                                             | CMDeck schedules lack cron syntax (confirmed)                                                           | Alternative: add cron + timezone parsing to existing `Schedule.ts`; Podium's single-flight and "at most one late fire" catch-up are the rules to copy.                                                                                    |
| AUT-02          | Deterministic scheduled scripts   | Sillage `scheduler/check.ts` (exit 0 wake / exit 10 skip, approval for agent-written scripts)                                                                                                                    | Verify                                                                                                  | Alternative — recommended shape for AUT-02.                                                                                                                                                                                               |
| AUT-03          | Heartbeat                         | Paseo `create_heartbeat` (maxRuns, expiresIn, bound to caller)                                                                                                                                                   | Verify                                                                                                  | Alternative: expose as an MCP tool over existing scheduled tasks.                                                                                                                                                                         |
| AUT-04          | Monitor loops                     | OpenChamber session goals; Sillage check gate                                                                                                                                                                    | Verify                                                                                                  | Alternative.                                                                                                                                                                                                                              |
| AUT-06          | Inbound webhooks                  | Frink extractors + Standard Webhooks verifier; Sillage QuickJS filter                                                                                                                                            | **In CMDeck**                                                                                           | Alternative enrichment; keep CMDeck's declarative filter (no QuickJS dependency).                                                                                                                                                         |
| AUT-07          | Quota recovery                    | Sillage (skip resume if user intervened); PandaCode account pools                                                                                                                                                | **In CMDeck** (`UsageLimitRecoveryWorker`)                                                              | Check Sillage's "skip if user wrote in between" rule. Account pools: **incompatible** (provider-terms risk).                                                                                                                              |
| CHT-01 / CHT-02 | Search / fork                     | OpenChamber SQLite message index; AO `sessionsearch`/`sessionfork`; Sillage/Jean handoff                                                                                                                         | Thread search + `ContextHandoffService` present                                                         | Verify search depth.                                                                                                                                                                                                                      |
| CHT-05          | Editable queued messages          | Emdash `CONTEXT.md` ("outcome unknown" rule)                                                                                                                                                                     | Verify                                                                                                  | Read Emdash's rules before implementing.                                                                                                                                                                                                  |
| TLS-01          | Live browser + takeover           | Paseo `browser-tools/*`; AO `browserstream/broker.go`; Jean agent-browser                                                                                                                                        | **In CMDeck** (Playwright preview, confirmed)                                                           | No action.                                                                                                                                                                                                                                |
| TLS-02          | Computer use                      | Orca `native/computer-use-*`; AO `computeruse/actions.go` ("not a sandbox")                                                                                                                                      | Verify against Kiro audit                                                                               | Alternative references only.                                                                                                                                                                                                              |
| TLS-03          | Markdown skills                   | Paseo installs skills into harness dirs; Emdash MCP sync to all agents                                                                                                                                           | Verify                                                                                                  | Alternative.                                                                                                                                                                                                                              |
| TLS-05          | Model routing                     | OpenChamber `routing/classifier.ts` (third-party classifiers)                                                                                                                                                    | Verify                                                                                                  | Alternative; local classifier only.                                                                                                                                                                                                       |
| INF-04          | Crash / orphan recovery           | Paseo terminal worker + `resumeOnStartup`; AoE runner registry + watchdog; Emdash session reconciliation; Jean detached Claude                                                                                   | Verify (`ProviderRuntimeRecoveryService` per deep dive)                                                 | Alternative. Emdash's reconciliation + Paseo's terminal worker are the most transferable.                                                                                                                                                 |
| INF-05 / INF-09 | Permission policies / OS sandbox  | OpenChamber folder trust; Paseo setup-script gating; Paseo grants                                                                                                                                                | Verify                                                                                                  | Trust fingerprinting is NEW-A01.                                                                                                                                                                                                          |
| INF-06 / INF-07 | Secrets / redaction               | Jean `chat/secrets.rs` (copies T3's file delivery); AO `triage_redact.go`; Sillage `secrets/*`                                                                                                                   | Secrets resolver present                                                                                | In CMDeck; redaction: verify.                                                                                                                                                                                                             |
| INF-08          | Chained audit log                 | Vigla `repository/revert_log.rs` (not hash-chained)                                                                                                                                                              | **Absent** (confirmed)                                                                                  | No hash-chained reference found among the 20.                                                                                                                                                                                             |
| INF-10          | Usage limits / alerts             | OpenChamber ~30 quota fetchers; Paseo usage-source plugins; AO collectors                                                                                                                                        | **In CMDeck**                                                                                           | Use OpenChamber's provider list as an endpoint catalogue.                                                                                                                                                                                 |
| INF-11 / CMD-11 | Alt harnesses / ACP               | Emdash 38 adapters + ACP runtime; AO ~50; PandaCode ACP catalog                                                                                                                                                  | In CMDeck                                                                                               | No action. Jean's removal of CLIProxyAPI is a warning against proxying subscription OAuth.                                                                                                                                                |
| MEM-01/07       | Memory                            | OpenChamber `agent-memory` (dreaming, `looksLikeInjection`); Sillage project-scoped memory                                                                                                                       | **Absent** (confirmed)                                                                                  | Alternative references; injection screening on memory writes is the key idea.                                                                                                                                                             |
| DEV-04          | Design tweak                      | Orca `browser-pane/annotate/*`; Nimbalyst mockup editors                                                                                                                                                         | Verify                                                                                                  | Alternative.                                                                                                                                                                                                                              |
| MSG-01..03      | Slack / Telegram / Teams          | Orca connector long-poll (hosted); Paseo Hub (separate service)                                                                                                                                                  | Verify                                                                                                  | Alternative pattern only: outbound long-poll, self-hosted.                                                                                                                                                                                |

## New proposals

None of these is approved scope. Effort assumes reuse of CMDeck services. "Paid?" means a paid service is introduced.

| ID      | Proposal                                                                                                                                                                                                    | Source                                                                                 | Use case                                                                                 | Value                 | Effort        | UI impact                      | Deps                               | Maintenance                           | Paid?                                                                                   | Duplicates existing?                                               | Recommendation                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------- | ------------- | ------------------------------ | ---------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| NEW-A01 | **Repo trust fingerprinting**: before a provider starts in a repo, hash what repo-local config would execute (`.mcp.json`, hooks, provider config, setup scripts) and ask again when it changes             | OpenChamber `lib/opencode-trust/*`; Paseo `SECURITY.md` setup gating                   | Opening a PR branch or a cloned repo silently starts MCP servers or hooks                | High (security)       | M             | Small approval dialog          | None                               | Low–medium (per-provider config list) | No                                                                                      | Partly overlaps INF-05 policies but covers a different risk        | **Recommend.**                                                                                  |
| NEW-A02 | **Agent-messaging brakes and addressing ceiling**: wake cooldown per (sender, target), daily spawn budget, hop/depth limit, and "agents address only what their user can see; refusals look like not-found" | Podium `brakes.ts`, `ceiling.ts`; Jean depth counter                                   | Two agents replying to each other spawn threads without limit; cross-environment control | High (stability)      | S–M           | None (settings only)           | None                               | Low                                   | No                                                                                      | Hardens existing `thread_send`/`delegate_task`/AGT-09              | **Recommend** with AGT-09.                                                                      |
| NEW-A03 | **Decisions inbox** for unattended runs: a scheduled or webhook run leaves a question with expiry and fallback; the answer returns to the session                                                           | Sillage `docs/features.md` (docs-only)                                                 | Overnight runs block or guess when they need a choice                                    | Medium                | M             | New inbox view (web + mobile)  | None                               | Medium                                | No                                                                                      | Partly overlaps T3 pending requests (`t3_pending_request`); verify | **Consider** after verifying pending-request coverage.                                          |
| NEW-A04 | **Multi-model fan-out**: one prompt to N providers, each in its own worktree, run server-side                                                                                                               | Jean `multi_model_prompt.rs`; OpenChamber `docs/multi-run.mdx`                         | Best-of-N comparison                                                                     | Medium                | S–M           | Composer option + compare view | None                               | Low                                   | No (uses user subscriptions)                                                            | Can be approximated with `create_threads`                          | **Consider** as a composer shortcut over `create_threads`.                                      |
| NEW-A05 | **Worktree hygiene**: `.worktreeinclude` copying of ignored files, auto-archive after merge, reclaim `node_modules`/build output from idle worktrees                                                        | Paseo `auto-archive-on-merge`, `worktree-include`; Emdash `cleanArtifacts`             | Fresh worktrees missing `.env`; disk fills with stale worktrees                          | Medium                | S each        | Settings toggles               | None                               | Low                                   | No                                                                                      | Verify against CMDeck worktree code                                | **Recommend** `.worktreeinclude` and auto-archive; reclaim optional.                            |
| NEW-A06 | **GitHub quota reserve** for background polling (separate REST/GraphQL budgets, 304 conditional requests)                                                                                                   | Jean `gh_cli/quota.rs`, `pr_status.rs`; AO ETag polling                                | PR/CI watchers starve the agents' own `gh` calls                                         | Medium                | S             | None                           | None                               | Low                                   | No                                                                                      | Extends PR watching                                                | **Recommend.**                                                                                  |
| NEW-A07 | **Issue-driven automation**: label filter → worktree → plan → build, with dry-run preview, attempt cap, active hours                                                                                        | Jean `auto_fix/*`; AO `trackerintake/observer.go`                                      | Hands-off fixes for labelled issues                                                      | Medium                | M             | Automation view                | None                               | Medium                                | No                                                                                      | Overlaps triage + workflows + AGT-01; may be a workflow template   | **Consider** as a workflow template, not a new engine.                                          |
| NEW-A08 | **Committee / advisor review skill** picking reviewers from different provider families                                                                                                                     | Paseo `skills/paseo-committee`, `paseo-advisor`                                        | Second opinions from a different vendor                                                  | Low–medium            | S             | None                           | None                               | Low                                   | No                                                                                      | Extends CMD-16                                                     | **Consider** as a bundled skill.                                                                |
| NEW-A09 | **Web Push for the PWA** with suppression rules (per-session cooldown, "waiting" threshold, none while foregrounded)                                                                                        | AoE `docs/push-notifications.md`; Sillage `push/push-service.ts`                       | Phone alerts without the native app or T3 push service                                   | High for CMD-23 users | M             | Permission prompt + settings   | `web-push` (VAPID), service worker | Low–medium                            | No (browser push services are free; payloads should be encrypted, which VAPID requires) | Not present (confirmed)                                            | **Recommend** under CMD-23.                                                                     |
| NEW-A10 | **Mission-level revert and deterministic submission gate**: revert all of a multi-agent run's merges at once; score each submission on tests, scope, lint and path-based risk before merge                  | Vigla `mission_workspace/revert.rs`, `audit/*`                                         | Undo a bad orchestrated run in one step                                                  | Medium                | M–L           | Revert button + gate summary   | None                               | Medium                                | No                                                                                      | Checkpoints exist per thread, not per multi-thread run             | **Consider** after AGT-03 lands. Vigla is stale; use as design reference.                       |
| NEW-A11 | **Plugin / extension system** (server plugins or sandboxed iframe guest panels)                                                                                                                             | Paseo `server/plugins/*` (unsandboxed); OpenChamber `lib/guests/*` (capability grants) | Third-party panels and providers                                                         | Medium                | XL            | Large                          | SDK surface                        | High                                  | No                                                                                      | No                                                                 | **Defer.** If ever built, follow OpenChamber's grant model, not Paseo's trust-everything model. |
| NEW-A12 | **More issue trackers** (Jira, Linear, Sentry issues, GitHub advisories, Plane …) as plugins                                                                                                                | Emdash `packages/plugins/src/issues/impl/*`; Jean `*_issues.rs`                        | Teams not on GitHub issues                                                               | Low–medium            | M per tracker | Settings                       | Tracker APIs                       | Medium                                | No                                                                                      | Extends issue linking                                              | **Defer** until requested.                                                                      |
| NEW-A13 | iOS Live Activity forwarder                                                                                                                                                                                 | Frink `live-activity-forwarder/`                                                       | Lock-screen progress                                                                     | Low                   | M             | iOS only                       | Apple push key, Cloudflare Worker  | Medium                                | Needs an Apple developer account                                                        | Conflicts with using the official T3 app (CMD-22)                  | **Reject.**                                                                                     |

## Ledger entries

Proposed lines for the `## Log` section of `docs/audit/RESEARCH_LEDGER.md` (the lead appends them; this
agent may only write `competitive-ades.*`):

```
- 2026-11-26 [competitive-ades] completed — Stage 1 for all 20 §7.1 projects; deep dives for Paseo, OpenChamber, Orca, Agent Orchestrator, Emdash, Jean, Nimbalyst, Agent of Empires, Podium, Frink, Sillage; lead read of PandaCode, Vigla, Sculptor. See research/competitive-ades.md (high).
- 2026-11-26 [competitive-ades] decision — "Podium ADE" = madeinorbit/podium (named so in kyrolabs/awesome-ade and arach/awesome-agent-clients), not eengelking/podium (high).
- 2026-11-26 [competitive-ades] decision — "Agent Orchestrator" = OrchestratorInc/agent-orchestrator (ComposioHQ URL redirects); private/ao-cloud submodule is out of scope and unlicensed (high).
- 2026-11-26 [competitive-ades] licence — Alethe AGPL-3.0 (reference only); PandaCode custom MIT+attribution notice; Paseo Apache-2.0 with third-party carve-out; Podium Apache-2.0 + NOTICE (high).
- 2026-11-26 [competitive-ades] completed — CMD-09 reference spec: AoE create_args mount table + AO dockerreap labels + Nimbalyst egress allowlist. CMD-10: no reference found (high).
- 2026-11-26 [competitive-ades] question — Does packages/shared/src/socketE2ee.ts reject replays and pin against downgrade like Paseo's relay? (open)
- 2026-11-26 [competitive-ades] proposed — NEW-A01..A13 (requires approval; not roadmap scope).
- 2026-11-26 [competitive-ades] conflict — PandaCode account pools are an AUT-07 alternative, but rotating accounts to bypass limits is a likely provider-terms violation; recommend against (med).
```

## Open questions

1. **CMD-02 relay crypto.** Does CMDeck's `socketE2ee.ts` provide replay rejection and downgrade pinning? Paseo
   fixed exactly this gap in its own legacy mode. Needs a code read, not a grep.
2. **CMD-09 on Windows.** AoE (the best reference) is Linux/macOS only. Should CMD-09 target Docker Desktop with
   WSL2 on Windows, and how do read-only `.git` overlays behave on Windows bind mounts? Untested.
3. **CMD-09 scope.** Should sandboxing route the whole provider process into the container (AoE) or only tool
   calls (container-use)? Only the first is an enforced boundary; recommend it.
4. **AUT-01 cron syntax.** Extend `apps/server/src/scheduledTasks/Schedule.ts` with cron + timezone (as Paseo,
   Emdash, Podium do) or keep interval schedules? Recommend extending with a small parser.
5. **"Verify" rows** (INF-04 recovery depth, host-key pinning in `packages/ssh/src/tunnel.ts`, wake-up
   persistence, auto-return of delegated results, worktree include/archive, CI nudge dedupe) need a CMDeck code
   read by the CMDeck agent before any is marked a gap.
6. **NEW-A03 vs existing pending requests.** Is the Decisions inbox already covered by T3's pending-request
   flow for unattended threads?
7. **Directory reliability.** `wandb/catnip` is listed but returns 404; `superset-sh/superset` now redirects to
   `ParadevAI/Paradev`; `erson/awesome-agent-orchestrators` was renamed and has no license. Use
   `erson/orchestration-atlas` and `kyrolabs/awesome-ade` for future discovery.
8. **Not reviewed:** Paseo Hub server, OpenChamber relay server (separate repo), Orca bot security docs (site
   only), Nimbalyst memory extension, Paradev internals, Cezar and Sikemux beyond READMEs.
