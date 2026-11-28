# New feature proposals

> **None of these proposals is in the approved roadmap.** They are ideas surfaced by the audit that go
> beyond the brief's existing requirements (§4) and selected Kiro Crew features (§5). Each needs the
> user's explicit approval before it enters `IMPLEMENTATION_ROADMAP.md` (brief §3 rules 9–10, §12.5).

Sources: [research/competitive-ades.md](research/competitive-ades.md) (NEW-A*),
[research/competitive-libraries.md](research/competitive-libraries.md) (NEW-B*), and the Kiro Crew notes
[research/kirocrew-agents-memory-automation-chat.md](research/kirocrew-agents-memory-automation-chat.md) (K1) and
[research/kirocrew-tools-infra-apps.md](research/kirocrew-tools-infra-apps.md) (K2) (NEW-C*, new in this file).
CMDeck status checks use [research/cmdeck-wishlist-coverage.md](research/cmdeck-wishlist-coverage.md) (COV).
Kiro unselected-feature IDs use the matrix numbering: **KCX-01..17** (K1) and **KCX-T01..T10** (K2,
renumbered in synthesis; see KIRO_CREW_PORT_ANALYSIS.md §1).

Sorted by recommendation (Recommend → Consider → Defer → Reject), then by expected value.
Effort uses brief §12.1 (S/M/L/XL) and assumes reuse of existing CMDeck services.

## Summary

| #   | ID      | Proposal                                               | Value               | Effort        | Recommendation                    | Merged from                                          |
| --- | ------- | ------------------------------------------------------ | ------------------- | ------------- | --------------------------------- | ---------------------------------------------------- |
| 1   | NEW-A01 | Trust boundary for repo config and external content    | High                | M–L           | **Recommend**                     | NEW-A01, NEW-B02, Kiro skill trust + nonce fences    |
| 2   | NEW-A02 | Agent-messaging brakes and addressing ceiling          | High                | S–M           | **Recommend**                     | NEW-A02, Kiro `authorize_target`, Jean depth counter |
| 3   | NEW-A09 | Web Push for the PWA                                   | High (CMD-23 users) | M             | **Approved 2026-11-26 → WI-3.11** | —                                                    |
| 4   | NEW-B01 | Forget memory by source thread                         | High                | S             | **Recommend**                     | —                                                    |
| 5   | NEW-B03 | Stuck-loop detector for autonomous runs                | High                | S–M           | **Recommend**                     | —                                                    |
| 6   | NEW-A05 | Worktree hygiene                                       | Medium              | S each        | **Recommend** (after verify)      | —                                                    |
| 7   | NEW-A06 | GitHub API quota reserve for background polling        | Medium              | S             | **Recommend**                     | NEW-A06, Kiro batched PR GraphQL                     |
| 8   | NEW-B04 | Cross-run review comment dedup                         | Medium              | S             | **Recommend**                     | —                                                    |
| 9   | NEW-B06 | Agent-invisible secret use                             | Medium–high         | M             | Consider                          | NEW-B06, KCX-T07                                     |
| 10  | NEW-A03 | Decisions inbox for unattended runs                    | Medium              | M             | Consider                          | —                                                    |
| 11  | NEW-A07 | Issue-driven automation template                       | Medium              | M             | Consider                          | —                                                    |
| 12  | NEW-A10 | Mission-level revert and deterministic submission gate | Medium              | M–L           | Consider                          | —                                                    |
| 13  | NEW-C02 | Recurring tool failures → user-drafted lesson          | Medium              | M             | Consider                          | KCX-17                                               |
| 14  | NEW-A08 | Committee / advisor review skill                       | Low–medium          | S             | Consider                          | —                                                    |
| 15  | NEW-A11 | Plugin / extension system                              | Medium              | XL            | Defer                             | NEW-A11, M3-37, upstream #34534                      |
| 16  | NEW-B05 | Local execution traces                                 | Medium              | M             | Defer                             | —                                                    |
| 17  | NEW-C01 | Merge a fork back as a note                            | Low–medium          | S             | Defer                             | KCX-05                                               |
| 18  | NEW-C03 | Bot goals and check-ins                                | Low–medium          | S–M           | Defer                             | KCX-14                                               |
| 19  | NEW-C04 | Session summary panel                                  | Low–medium          | M             | Defer                             | KCX-15                                               |
| 20  | NEW-A12 | More issue trackers                                    | Low–medium          | M per tracker | Defer                             | —                                                    |
| 21  | NEW-C06 | Additional messaging channels                          | Low–medium          | M per channel | Defer                             | KCX-T10                                              |
| 22  | NEW-C05 | Signed policy documents                                | Low                 | M             | Defer                             | KCX-T06                                              |
| 23  | NEW-A04 | Multi-model fan-out                                    | —                   | —             | Reject (duplicate)                | —                                                    |
| 24  | NEW-A13 | iOS Live Activity forwarder                            | Low                 | M             | Reject                            | —                                                    |

Retired ID: **NEW-B02** (untrusted-content envelopes) is merged into NEW-A01.

---

## Recommend

### NEW-A01 Trust boundary for repo config and external content

_Merged from NEW-A01 (repo trust fingerprinting) and NEW-B02 (untrusted-content envelopes), plus Kiro's
per-directory skill consent and nonce-fenced chunks. Both halves need the same thing: a provenance tag
for input the user did not write, and a rule that such input never runs or becomes instructions without
the user's consent. They can still be approved and shipped as two slices._

- **Description.**
  - (a) _Repo trust_: before a provider starts in a repo, hash what repo-local config would execute
    (`.mcp.json`, hooks, provider config, setup scripts, project skills) and ask again when the hash changes.
  - (b) _Content envelopes_: wrap page text, web fetches, PR comments, webhook payloads and inbound
    channel messages in nonce-tagged boundary markers and tag them `untrusted`, so they cannot become
    memory, lessons or rules without approval.
- **Source.** OpenChamber `lib/opencode-trust/{assessment,store,fetch-guard}.ts`; Paseo `SECURITY.md`
  (setup scripts not run until approved); agent-browser `--content-boundaries`
  (`docs/content/docs/security.mdx`); OpenClaw origin classes; Kiro `kc/skill_trust.py`, knowledge
  `<<<BEGIN_UNTRUSTED_CHUNK_{nonce}>>>` fences, and "a worker report is data, never a prompt" (`kc/mcp_work.py`).
- **Use case.** Opening a PR branch or a cloned repo silently starts MCP servers or hooks; a web page or
  a Telegram message injects instructions.
- **Expected value.** High (security, §9.4, §10).
- **Effort.** M per slice.
- **UI impact.** A small approval dialog; "from untrusted source" badges on staged memory.
- **Dependencies.** None for (a). (b) shares the provenance column with D6 memory.
- **Maintenance.** Low–medium: a per-provider list of executable config files.
- **Paid services.** No.
- **Duplicates existing?** Partly. CMDeck already wraps webhook values as untrusted data (COV TLS-08) and
  has policies (INF-05); this generalises both. Overlaps INF-07 and TLS-08.
- **Recommendation: Recommend.** High value for modest effort; slice (b) should land with MEM-01 so memory
  is never built on untagged input. Document it as defence in depth, not a boundary (§15).

### NEW-A02 Agent-messaging brakes and addressing ceiling

_Merged with Kiro's `authorize_target` gate (K1 CHT-03) and Jean's delegation depth counter._

- **Description.** Wake cooldown per (sender, target); daily spawn budget; hop/depth limit; agents may
  address only what their user can see, and refusals look like "not found"; one deny-by-default target
  gate that refuses self, incognito/temporary threads and ambiguous targets, with every refusal audited.
- **Source.** Podium `apps/server/src/modules/messages/brakes.ts`, `packages/commands/src/mail/ceiling.ts`
  (Apache-2.0 + NOTICE); Jean `jean-core/src/chat/delegation.rs`; Kiro
  `kc/dashboard/session_control_parts/target_authorization.py`.
- **Use case.** Two agents reply to each other and spawn threads without limit; an agent pokes a thread
  on another machine the user never opened.
- **Expected value.** High (stability, cost).
- **Effort.** S–M.
- **UI impact.** Settings only.
- **Dependencies.** None. Refusal audit uses INF-08 once it exists.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Hardens existing `t3_thread_send`, `delegate_task` and the no-escalation rule
  (`mcp/delegatedTaskModes.ts`); does not replace them.
- **Recommendation: Recommend** alongside AGT-09/AGT-03 work.

### NEW-A09 Web Push for the PWA

- **Description.** Self-hosted VAPID Web Push with a service worker, plus suppression rules: per-session
  cooldown, a "waiting" threshold, nothing while the app is foregrounded.
- **Source.** Sillage `apps/server/src/push/push-service.ts`; AoE `docs/push-notifications.md` (**docs-only**).
- **Use case.** Phone alerts for finished or blocked threads without the native app or T3's push service.
- **Expected value.** High for CMD-23 users; it is also the delivery path INF-10 alerts and AUT-03
  heartbeats need (COV OQ5).
- **Effort.** M.
- **UI impact.** Permission prompt and a settings section.
- **Dependencies.** `web-push` (license **verify**), a service worker.
- **Maintenance.** Low–medium.
- **Paid services.** No (browser push services are free; VAPID requires encrypted payloads).
- **Duplicates existing?** No. CMDeck's push publishing is a no-op since `51905decad` (COV).
- **Recommendation: Recommend.** Lead decision **D8 already assumes it**, and it arguably sits inside CMD-23;
  the user should confirm it moves to the roadmap. The official mobile app still needs T3's hosted relay
  for push (D8).

### NEW-B01 Forget memory by source thread

- **Description.** Record the source thread of every memory item. "Forget memories from thread X" shows a
  dry-run preview, deletes them and stops re-ingestion.
- **Source.** OpenClaw `docs/concepts/memory-provenance.md` (`openclaw memory forget --session … --dry-run`).
- **Use case.** A thread contained secrets or bad advice; remove everything learned from it.
- **Expected value.** High (privacy, §10 "memory respects user control").
- **Effort.** S once MEM-01 stores `source_thread_id`.
- **UI impact.** One action in the thread menu and in Memory settings.
- **Dependencies.** MEM-01 (D6).
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Extends MEM-02 (and Kiro's "what was remembered from this thread" view).
- **Recommendation: Recommend with MEM-01**: the cost is one column and one query.

### NEW-B03 Stuck-loop detector for autonomous runs

- **Description.** Deterministic detection of repeated action/observation pairs, repeated errors,
  monologues, alternating loops and context-overflow loops; pause the run or notify.
- **Source.** OpenHands `software-agent-sdk@7cfef13a0a:openhands-sdk/openhands/sdk/conversation/stuck_detector.py` (MIT).
- **Use case.** Overnight Task Runner, bot or monitor-loop runs that burn quota in a loop.
- **Expected value.** High; cheap.
- **Effort.** S–M.
- **UI impact.** A "Paused: looping" status.
- **Dependencies.** None.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** No. Complements AUT-03/04, TLS-07 and the AGT-01/DEV-02 presets.
- **Recommendation: Recommend.** Deterministic, consistent with §9.5 and §15.

### NEW-A05 Worktree hygiene

- **Description.** `.worktreeinclude` copying of ignored files (such as `.env`) into new worktrees;
  auto-archive a worktree after its PR merges; optionally reclaim `node_modules`/build output from idle worktrees.
- **Source.** Paseo `server/auto-archive-on-merge/index.ts`, `plugins/worktree-include/server/copy.ts`;
  Emdash `cleanArtifacts` (`CONTEXT.md`, **docs-only**).
- **Use case.** Fresh worktrees missing `.env`; disks filling with stale worktrees.
- **Expected value.** Medium.
- **Effort.** S each.
- **UI impact.** Settings toggles.
- **Dependencies.** None.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Partly: CMDeck's staged worktree setup has a `setup-script` stage
  (`packages/contracts/src/worktreeSetup.ts`) that can copy files today. **Verify** against CMDeck's
  worktree code before building (CA OQ5).
- **Recommendation: Recommend** `.worktreeinclude` and auto-archive after verification; reclaim optional.

### NEW-A06 GitHub API quota reserve for background polling

_Merged with Kiro's batched multi-PR GraphQL reads (K1 AUT-05) and Agent Orchestrator's ETag polling._

- **Description.** Separate REST and GraphQL budgets that keep a reserve for the agents' own `gh` calls;
  conditional requests (304); batch several PRs per GraphQL query.
- **Source.** Jean `gh_cli/quota.rs` (`RESERVE_DIVISOR`), `projects/pr_status.rs`; AO
  `observe/scm/observer.go`; Kiro `kc/monitoring/github_pull_request.py`.
- **Use case.** PR/CI watchers starve the agents of GitHub API quota.
- **Expected value.** Medium.
- **Effort.** S.
- **UI impact.** None.
- **Dependencies.** None.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Extends PR watch (T3-04, CMX-06).
- **Recommendation: Recommend.**

### NEW-B04 Cross-run review comment dedup

- **Description.** Fingerprint each inline review finding (SHA-256 in an HTML-comment marker) and skip
  findings already posted on earlier runs.
- **Source.** PR-Agent `pr_agent/algo/inline_comment_dedup.py` (MIT).
- **Use case.** Re-reviews after each push stop re-posting the same comments.
- **Expected value.** Medium.
- **Effort.** S.
- **UI impact.** None.
- **Dependencies.** None.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Refines DEV-01 / CMD-16 (CMX-01).
- **Recommendation: Recommend** as part of DEV-01 work.

---

## Consider

### NEW-B06 Agent-invisible secret use

_Merged from NEW-B06 (browser logins) and KCX-T07 (Kiro mediated secret dispatch): both keep secret
plaintext out of the model's context._

- **Description.**
  - (a) Browser logins: site credentials live in the vault; the browser service fills login forms after an
    origin check.
  - (b) Mediated API calls: the agent asks for a request by secret _name_; the server checks owner
    authorisation and the exact origin, pins DNS, injects the secret in memory, disables redirects and
    returns a sanitised response.
- **Source.** agent-browser "Authentication Vault" (`security.mdx`); Kiro `kc/secrets_mediation/dispatch.py`.
- **Use case.** Live browser or bots logging into dashboards; agents calling APIs without seeing keys.
- **Expected value.** Medium–high.
- **Effort.** M per slice.
- **UI impact.** Vault entries gain "browser login" and "API credential" types.
- **Dependencies.** INF-06 (D10 encrypted vault).
- **Maintenance.** Medium (login-form heuristics; response sanitisation).
- **Paid services.** No.
- **Duplicates existing?** Extends INF-06 and TLS-01; CMDeck already has private secret requests
  (`secrets/SecretRequests.ts`, `request_secret`) and 1Password references.
- **Recommendation: Consider after INF-06 lands.**

### NEW-A03 Decisions inbox for unattended runs

- **Description.** A scheduled or webhook run that needs a choice leaves a question with an expiry and a
  fallback answer; the reply returns to the session.
- **Source.** Sillage `docs/features.md` (**docs-only**).
- **Use case.** Overnight runs block or guess when they need a choice.
- **Expected value.** Medium.
- **Effort.** M.
- **UI impact.** A new inbox view (web and mobile).
- **Dependencies.** None.
- **Maintenance.** Medium.
- **Paid services.** No.
- **Duplicates existing?** Possibly: T3 pending requests (`t3_pending_request`) and workflow `ask`
  already route questions. **Verify** first (CA OQ6).
- **Recommendation: Consider** only if pending requests do not already cover unattended threads.

### NEW-A07 Issue-driven automation template

- **Description.** Label filter → worktree → plan → build, with dry-run preview, attempt cap and active hours.
- **Source.** Jean `jean-core/src/auto_fix/{scheduler,types}.rs` (`AUTO_FIX_MAX_ATTEMPTS = 3`); AO
  `observe/trackerintake/observer.go`.
- **Use case.** Hands-off fixes for labelled issues.
- **Expected value.** Medium.
- **Effort.** M.
- **UI impact.** An automation view, or none if it is a workflow template.
- **Dependencies.** Workflows out of Labs (D4); issue-tracker bindings.
- **Maintenance.** Medium.
- **Paid services.** No.
- **Duplicates existing?** Overlaps triage (`triage/TriageService.ts`), workflow `issuesOpened` triggers and AGT-01.
- **Recommendation: Consider** as a workflow template, never a new engine.

### NEW-A10 Mission-level revert and deterministic submission gate

- **Description.** Revert all merges of a multi-agent run at once; score each submission on tests, scope,
  lint and path-based risk before merge.
- **Source.** Vigla `crates/orchestrator/src/mission_workspace/revert.rs`, `crates/orchestrator/src/audit/`
  (Apache-2.0; **stale** since 2026-07-27).
- **Use case.** Undo a bad orchestrated run in one step.
- **Expected value.** Medium.
- **Effort.** M–L.
- **UI impact.** A revert button and a gate summary.
- **Dependencies.** AGT-03 conductor runs and the AGT-07 work ledger.
- **Maintenance.** Medium.
- **Paid services.** No.
- **Duplicates existing?** Checkpoints exist per thread, not per multi-thread run.
- **Recommendation: Consider after AGT-03 lands**; Vigla is a design reference only.

### NEW-C02 Recurring tool failures → user-drafted lesson

- **Description.** A card lists tool calls that keep failing the same way; the user drafts a lesson from
  it. The user writes the rule, so it is a safe self-learning input.
- **Source.** Kiro `website/src/pages/overview/MemoryFailuresCard.tsx`, `/api/sel/recurring-failures`
  (KCX-17; file names only, not read in depth).
- **Use case.** The agent keeps running the wrong test command; one click turns that into a lesson.
- **Expected value.** Medium (**inferred**).
- **Effort.** M (failure aggregation from thread activity; Kiro uses its security event log).
- **UI impact.** One card in the memory view.
- **Dependencies.** MEM-03 (D6); a failure aggregate, possibly from INF-08.
- **Maintenance.** Low–medium.
- **Paid services.** No.
- **Duplicates existing?** No.
- **Recommendation: Consider with MEM-03.** It is the poisoning-safe way to seed lessons.

### NEW-A08 Committee / advisor review skill

- **Description.** A bundled skill that picks reviewers from different provider families for second opinions.
- **Source.** Paseo `skills/paseo-committee/SKILL.md`, `skills/paseo-advisor/SKILL.md`.
- **Use case.** Second opinions from a different vendor.
- **Expected value.** Low–medium.
- **Effort.** S.
- **UI impact.** None.
- **Dependencies.** None.
- **Maintenance.** Low.
- **Paid services.** No (uses the user's subscriptions).
- **Duplicates existing?** Extends CMX-01 second-model review (`t3_thread_review`).
- **Recommendation: Consider** as a bundled skill only.

---

## Defer

### NEW-A11 Plugin / extension system

_Merged with M3 Code's plugin host (M3-37, not incorporated in CMDeck) and upstream's open host-extensions
SDK PR #34534._

- **Description.** Server plugins or sandboxed iframe guest panels for third-party panels and providers.
- **Source.** Paseo `server/plugins/*` (unsandboxed); OpenChamber `lib/guests/*` (capability grants, tokens
  never reach the iframe); M3 `m3/plugin-host`; upstream #34534 (+13,456 lines, open, mergeable).
- **Use case.** Third-party panels and providers without forking.
- **Expected value.** Medium.
- **Effort.** XL.
- **UI impact.** Large.
- **Dependencies.** An SDK surface; upstream #34534.
- **Maintenance.** High.
- **Paid services.** No.
- **Duplicates existing?** Would duplicate upstream #34534 if that merges.
- **Recommendation: Defer** and wait for #34534 (D15). If ever built, follow OpenChamber's grant model,
  not Paseo's trust-everything model.

### NEW-B05 Local execution traces

- **Description.** Opt-in capture of the server's existing Effect spans to local storage or a
  user-specified OTLP endpoint, plus a per-turn or per-run trace view.
- **Source.** `effect/observability/OtlpTracer` (already in the Effect dependency).
- **Use case.** Debugging slow turns or failed workflows without phone-home.
- **Expected value.** Medium.
- **Effort.** M (the viewer is most of it).
- **UI impact.** A diagnostics panel.
- **Dependencies.** None new. Interacts with **D2**: whether upstream's in-process tracing modules are kept
  with all exporters deleted.
- **Maintenance.** Medium.
- **Paid services.** No.
- **Duplicates existing?** No. Distinct from telemetry: **no default endpoint**, off by default.
- **Recommendation: Defer** until D2 is decided; start with export only, no viewer.

### NEW-C01 Merge a fork back as a note

- **Description.** A background model drafts a summary of a fork; the user edits it and it is posted into
  the parent thread as a note.
- **Source.** Kiro `kc/dashboard/chat_merge_back.py` (API only; Kiro has no web client for it) (KCX-05).
- **Use case.** Bring the conclusion of a side exploration back without copying the whole fork.
- **Expected value.** Low–medium.
- **Effort.** S once CHT-09's note command exists.
- **UI impact.** A "Merge back" action with an editable summary.
- **Dependencies.** CHT-09; per-purpose text generation (`textGeneration/TextGenerators.ts`, local-first).
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** **Partly.** Merge-back itself exists and is tested (`orchestration-v2/ThreadManagementService.ts`,
  `testkit/ThreadMergeBack.integration.test.ts`; FEATURE_AUDIT.md conflict 6; matrix KCX-05 Existing — retain).
  Still to check: whether it returns an editable summary, in which case only a UI entry point is missing.
- **Recommendation: Defer** until that check.

### NEW-C03 Bot goals and check-ins

- **Description.** Goals and key results per bot with scheduled daily/weekly/monthly check-in reports.
- **Source.** Kiro `kc/member_goals.py`, `kc/dashboard/handlers/member_goals.py` (KCX-14).
- **Use case.** A long-lived bot reports progress against stated goals.
- **Expected value.** Low–medium.
- **Effort.** S–M.
- **UI impact.** A goals section in the bot profile.
- **Dependencies.** AGT-02 bots (D7); scheduled tasks.
- **Maintenance.** Low.
- **Paid services.** No.
- **Duplicates existing?** Mostly expressible today as a scheduled task with a check-in prompt.
- **Recommendation: Defer** until bots exist and a user asks for more than a scheduled prompt.

### NEW-C04 Session summary panel

- **Description.** A side panel with a background-model summary of the session.
- **Source.** Kiro `spec/session-summary.md` (**docs-only**) (KCX-15).
- **Use case.** Catch up on a long thread.
- **Expected value.** Low–medium.
- **Effort.** M.
- **UI impact.** A right-panel tab.
- **Dependencies.** Background inference (opt-in, local-first).
- **Maintenance.** Medium.
- **Paid services.** No (but adds inference cost unless local).
- **Duplicates existing?** Possibly: upstream PR #43623 adds a thread map of turns, agents and messages (T3-U05).
- **Recommendation: Defer** until #43623 is evaluated.

### NEW-A12 More issue trackers

- **Description.** Jira, Linear, Sentry issues, GitHub advisories, Plane and others as tracker plugins.
- **Source.** Emdash `packages/plugins/src/issues/impl/*`; Jean `*_issues.rs`.
- **Use case.** Teams not on GitHub issues.
- **Expected value.** Low–medium.
- **Effort.** M per tracker.
- **UI impact.** Settings.
- **Dependencies.** Tracker APIs.
- **Maintenance.** Medium.
- **Paid services.** No (the trackers themselves may be paid products).
- **Duplicates existing?** Extends CMDeck's issue-tracker bindings and the Vikunja package (M3-34).
- **Recommendation: Defer** until requested.

### NEW-C06 Additional messaging channels

- **Description.** Discord, WhatsApp, Feishu, Webex, WeCom, Weixin and iMessage adapters.
- **Source.** Kiro channel stacks under `src/kiro_crew/` (KCX-T10; WhatsApp via `neonize`).
- **Use case.** Users whose team is not on Slack, Telegram or Teams.
- **Expected value.** Low–medium.
- **Effort.** M per channel.
- **UI impact.** Settings → Integrations entries.
- **Dependencies.** The D13 adapter interface (on the notification service outbox, WI-1.04; D5 as refined).
- **Maintenance.** Medium per channel.
- **Paid services.** Platform terms and account requirements vary per channel (**verify**).
- **Duplicates existing?** No.
- **Recommendation: Defer** until MSG-01/02 ship and the adapter interface is proven.

### NEW-C05 Signed policy documents

- **Description.** Policies loaded from a trust root and verified with Ed25519; effective policy =
  policy ∩ profile.
- **Source.** Kiro `platform/governance_parts/signature.py` (`ed25519_verify`) (KCX-T06).
- **Use case.** An administrator locks policy so a local user or agent cannot loosen it.
- **Expected value.** Low for a single-user, local-first fork.
- **Effort.** M.
- **UI impact.** None (admin files).
- **Dependencies.** Key management.
- **Maintenance.** Medium.
- **Paid services.** No.
- **Duplicates existing?** Partly: managed policy already refuses to start on a file it cannot enforce
  (`policy/ManagedPolicy.ts`).
- **Recommendation: Defer.** K2 already marked it "Not selected".

---

## Reject

### NEW-A04 Multi-model fan-out

- **Description.** One prompt to N providers, each in its own worktree, server-side, with a compare view.
- **Source.** Jean `projects/multi_model_prompt.rs`; OpenChamber `docs/multi-run.mdx`.
- **Expected value / effort.** Medium / S–M as originally proposed.
- **Duplicates existing?** **Yes.** COV AGT-04 lists multi-model fan-out on send (docs-only:
  `docs/user/thread-sidebar.md` §Start in the background), and `create_threads` covers the agent path.
- **Recommendation: Reject** as a duplicate. Only a side-by-side compare view would be new; propose that
  separately if wanted.

### NEW-A13 iOS Live Activity forwarder

- **Description.** Lock-screen progress through a Live Activity forwarder.
- **Source.** Frink `live-activity-forwarder/` (a Cloudflare Worker).
- **Expected value.** Low.
- **Effort.** M.
- **UI impact.** iOS only.
- **Dependencies.** Apple push key and a Cloudflare Worker.
- **Paid services.** Needs an Apple developer account.
- **Duplicates existing?** Conflicts with using the official T3 mobile app (CMD-22).
- **Recommendation: Reject.**

---

## Surfaced but not proposed

These came up in the research but are not proposals, for the reason given.

| Item                                                                                                               | Reason                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| KCX-01/02 Crew board, chat-tag columns                                                                             | Boards are excluded (EXC).                                                                              |
| KCX-03/04, KCX-T03 telemetry, beacon, CDN downloads, update checks                                                 | Excluded (CMD-01).                                                                                      |
| KCX-T02 Kiro relay and managed environments                                                                        | Hosted by Kiro (CMD-06).                                                                                |
| KCX-T04 Responses-style `/v1` REST API                                                                             | A second public API surface; INF-02 is covered by RPC + MCP.                                            |
| KCX-T05 Voice via Polly/Transcribe                                                                                 | Paid AWS services; CMDeck has preview voice annotations already.                                        |
| KCX-T08 AWS project → profile binding                                                                              | Part of BRK-AUTH / D12 (per-instance `AWS_*` scoping).                                                  |
| KCX-T09 "Share My Crew" packaging                                                                                  | Not enough evidence in the notes to evaluate.                                                           |
| KCX-T01 Connected computers                                                                                        | Covered by CMD-12; Kiro's confinement is Linux-only.                                                    |
| KCX-06 Rewind / edit and resend; KCX-08 side chat; KCX-09 prompt stash                                             | Already present or overlapping in T3/CMDeck (COV).                                                      |
| KCX-07 Broadcast to many sessions                                                                                  | Overlaps CHT-03; low priority.                                                                          |
| KCX-10 Promote incognito → persistent; KCX-16 self-arming loops                                                    | Part of MEM-06 and AUT-04 respectively.                                                                 |
| KCX-11/12 Onboarding importer, portability zip                                                                     | Part of CMD-20/21 (D16).                                                                                |
| KCX-13 Memory provider abstraction                                                                                 | Not needed; avoid (one memory system, D6).                                                              |
| Improvements to implemented features (browser input lock, PR-watch fingerprinting, cron jitter, …)                 | Listed in KIRO_CREW_PORT_ANALYSIS.md §4 and COMPETITIVE_RESEARCH.md §3 as improvements to existing IDs. |
| M3 items not yet incorporated (M3-09 local engine manager, M3-27 monospace font, M3-28 default thread environment) | Belong to [M3_CODE_ANALYSIS.md](M3_CODE_ANALYSIS.md).                                                   |
