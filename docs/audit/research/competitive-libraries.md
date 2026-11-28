# Competitive research: libraries and frameworks (brief §7.2–7.5, §7.7)

Agent: `competitive-libraries`. Access date for every repository: **2026-11-26**. CMDeck baseline:
`Tehcnological/cmdeck@4a2f27d590`.

Evidence convention: `repo@sha:path[:line]`. **(verified)** means I read the source or file at that
SHA. **(docs-only)** means I read only README or docs. **(inferred)** means general knowledge I did
not re-check in source on this date. Clones were shallow, read-only, and nothing was built or run.

The key result: CMDeck already has most of the infrastructure these libraries offer. It has durable
workflows built on `effect/workflow`, an FTS5 search index, a Playwright-core browser with CDP
screencast and takeover, subscription-limit probes, and a LiteLLM price map. So the most useful
outputs are **patterns to copy**, not dependencies. Only a few small, permissive, TS-native packages
are worth adopting. They are messaging SDKs, plus `sqlite-vec` as an option.

---

## 1. Identity & license table

| Requested URL                   | Actual repo (redirect/rename)              | SPDX at HEAD                                            | Mixed / caveats                                                                                                       | HEAD SHA     | Last commit (main)             | Lang        | Notes                                                                                                                  |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| letta-ai/letta                  | letta-ai/letta                             | Apache-2.0                                              | —                                                                                                                     | `8816d3a851` | 2026-10-18                     | —           | **Server retired.** README says that current source is `letta-ai/letta-code` and that V1 lives on the `archive` branch |
| (follow-on)                     | letta-ai/letta-code                        | Apache-2.0                                              | has `src/telemetry` (opt-out `LETTA_TELEMETRY_DISABLED`)                                                              | `4d5928b1d0` | 2026-11-26                     | TS          | Audited in place of letta                                                                                              |
| mem0ai/mem0                     | mem0ai/mem0                                | Apache-2.0                                              | **Telemetry on by default** (PostHog, `MEM0_TELEMETRY`)                                                               | `a330119bda` | 2026-11-25                     | Python      |                                                                                                                        |
| getzep/graphiti                 | getzep/graphiti                            | Apache-2.0                                              | PostHog telemetry (`GRAPHITI_TELEMETRY_ENABLED`)                                                                      | `fbf38693df` | 2026-11-26                     | Python      | Needs graph DB (Neo4j/FalkorDB/Neptune/embedded "Relate")                                                              |
| topoteretes/cognee              | topoteretes/cognee                         | Apache-2.0                                              | NOTICE.md; telemetry unless `TELEMETRY_DISABLED`                                                                      | `c78a56ff4a` | 2026-11-26                     | Python      |                                                                                                                        |
| openclaw/openclaw               | openclaw/openclaw                          | MIT                                                     | THIRD_PARTY_NOTICES.md                                                                                                | `f57a32938b` | 2026-11-26                     | TS          | Very large monorepo                                                                                                    |
| NousResearch/hermes-agent       | NousResearch/hermes-agent                  | MIT                                                     | —                                                                                                                     | `c925e8bbc4` | 2026-11-26                     | Python      |                                                                                                                        |
| All-Hands-AI/OpenHands          | **OpenHands/OpenHands**                    | MIT                                                     | —                                                                                                                     | `be48abe258` | 2026-11-26                     | TS          | Now "Agent Canvas", an ADE (sibling scope). Agent runtime moved to the SDK repo below                                  |
| (follow-on)                     | OpenHands/software-agent-sdk               | MIT                                                     | —                                                                                                                     | `7cfef13a0a` | 2026-11-26                     | Python      | Event log, stuck detector, security analyzers                                                                          |
| openai/symphony                 | openai/symphony                            | Apache-2.0                                              | NOTICE                                                                                                                | `be10a1b79d` | 2026-09-15                     | Elixir      | **Exists.** A spec (`SPEC.md`) plus an Elixir reference implementation                                                 |
| langchain-ai/langgraph          | langchain-ai/langgraph                     | MIT                                                     | —                                                                                                                     | `3e3dbd42c5` | 2026-11-25                     | Python      |                                                                                                                        |
| temporalio/temporal             | temporalio/temporal                        | MIT                                                     | —                                                                                                                     | `c2ec24c01c` | 2026-11-26                     | Go          | Server; needs DB                                                                                                       |
| triggerdotdev/trigger.dev       | triggerdotdev/trigger.dev                  | Apache-2.0                                              | —                                                                                                                     | `e0e60ff6ca` | 2026-11-25                     | TS          |                                                                                                                        |
| microsoft/autogen               | microsoft/autogen                          | CC-BY-4.0 (docs) + MIT (`LICENSE-CODE`)                 | **Archived**, unmaintained                                                                                            | `8390985108` | 2026-11-12                     | Python      | README points to microsoft/agent-framework                                                                             |
| crewAIInc/crewAI                | crewAIInc/crewAI                           | MIT                                                     | telemetry module (`lib/crewai/src/crewai/telemetry/`)                                                                 | `77237aecac` | 2026-11-25                     | Python      |                                                                                                                        |
| browser-use/browser-use         | browser-use/browser-use                    | MIT                                                     | PostHog telemetry (`ANONYMIZED_TELEMETRY`)                                                                            | `94784c1f7e` | 2026-11-24                     | Python      |                                                                                                                        |
| microsoft/playwright            | microsoft/playwright                       | Apache-2.0                                              | —                                                                                                                     | `c2ebabaf15` | 2026-11-26                     | TS          | CMDeck already depends on `playwright-core@1.64.1`                                                                     |
| microsoft/playwright-mcp        | microsoft/playwright-mcp                   | Apache-2.0                                              | —                                                                                                                     | `2337aff021` | 2026-11-18                     | TS          | Thin wrapper over `playwright-core` tools                                                                              |
| browserbase/stagehand           | browserbase/stagehand                      | MIT                                                     | Hosted cache/gateway upsell                                                                                           | `97ff3e1189` | 2026-11-25                     | TS          | v4                                                                                                                     |
| vercel-labs/agent-browser       | vercel-labs/agent-browser                  | Apache-2.0                                              | Default Chrome-release version check makes an outbound request                                                        | `a67ba089fe` | 2026-11-26                     | Rust        |                                                                                                                        |
| mediar-ai/screenpipe            | **screenpipe/screenpipe**                  | **NOASSERTION: "Screenpipe Commercial License"**        | Source-available. Commercial use needs Enterprise; free use is limited to personal, non-profit, or a 7-day evaluation | `b36b653cc4` | 2026-11-26                     | Rust        | **Do not copy code**                                                                                                   |
| steipete/CodexBar               | steipete/CodexBar                          | MIT                                                     | —                                                                                                                     | `a26ca57b51` | 2026-11-21                     | Swift       | macOS app                                                                                                              |
| ryoppippi/ccusage               | **ccusage/ccusage**                        | MIT                                                     | **Anonymous daily telemetry ping** (`telemetry/README.md`)                                                            | `98b9dbd84a` | 2026-11-26                     | Rust (+TS)  | Rewritten in Rust                                                                                                      |
| BerriAI/litellm                 | BerriAI/litellm                            | NOASSERTION: **MIT + `litellm/enterprise/` commercial** | Rust core via maturin                                                                                                 | `7351177434` | 2026-11-26                     | Python/Rust | Price JSON is MIT (root)                                                                                               |
| lm-sys/RouteLLM                 | lm-sys/RouteLLM                            | Apache-2.0                                              | **Stale**                                                                                                             | `0b64fdafe0` | **2024-08-10**                 | Python      |                                                                                                                        |
| langfuse/langfuse               | langfuse/langfuse                          | NOASSERTION: **MIT + `ee/` dirs commercial**            | —                                                                                                                     | `d2d83fc751` | 2026-11-26                     | TS          |                                                                                                                        |
| promptfoo/promptfoo             | promptfoo/promptfoo                        | MIT                                                     | PostHog telemetry (`PROMPTFOO_DISABLE_TELEMETRY`)                                                                     | `485074451b` | 2026-11-26                     | TS          |                                                                                                                        |
| qodo-ai/pr-agent                | **The-PR-Agent/pr-agent**                  | MIT                                                     | —                                                                                                                     | `834d450ee4` | 2026-11-26                     | Python      | Community-owned, "not the Qodo free tier"                                                                              |
| TabbyML/tabby                   | TabbyML/tabby                              | NOASSERTION: **Apache-2.0 + `ee/` Enterprise**          | —                                                                                                                     | `21b29048d7` | 2026-06-30                     | Rust        | Slowing                                                                                                                |
| continuedev/continue            | continuedev/continue                       | Apache-2.0                                              | CLA                                                                                                                   | `5522c6f44c` | **2026-07-21**                 | TS          | main is quiet: last commits retire the login flow                                                                      |
| Aider-AI/aider                  | Aider-AI/aider                             | Apache-2.0                                              | tree-sitter `.scm` queries carry their upstream licenses (`aider/queries/*/README.md`)                                | `5dc9490bb3` | 2026-05-22                     | Python      | Slowing                                                                                                                |
| open-policy-agent/opa           | open-policy-agent/opa                      | Apache-2.0                                              | —                                                                                                                     | `3dc49738d5` | 2026-11-26                     | Go          |                                                                                                                        |
| NVIDIA/OpenShell                | **ai-openshell/openshell** (moved to CNCF) | Apache-2.0                                              | THIRD-PARTY-NOTICES; **anonymous telemetry, opt-out**                                                                 | `94a9527f82` | 2026-11-26                     | Rust        | **Exists** (README note: "now part of the CNCF")                                                                       |
| google/gvisor                   | **gvisor/gvisor**                          | Apache-2.0                                              | default branch `master`                                                                                               | `cc5b7474bf` | 2026-11-26                     | Go          | Linux only (inferred)                                                                                                  |
| open-telemetry/opentelemetry-js | open-telemetry/opentelemetry-js            | Apache-2.0                                              | —                                                                                                                     | `3a84fa9fe2` | 2026-11-26                     | TS          |                                                                                                                        |
| (memory option)                 | asg017/sqlite-vec                          | Apache-2.0 / MIT (dual files)                           | —                                                                                                                     | `04d28bd217` | 2026-05-18 (v0.1.9 2026-03-31) | C           | Slow cadence                                                                                                           |

Telemetry-on-by-default libraries are mem0, graphiti, cognee, browser-use, promptfoo, ccusage,
crewAI, OpenShell and (opt-out) letta-code. Any of them used as a dependency would need its kill
switch forced in code. That alone conflicts with brief §10 ("optional modules must not initiate
network requests"), so none of them is recommended as a runtime dependency.

---

## 2. Memory (MEM-01…10)

### What each project actually does

**Letta (letta-code)**

- Memory is a git-backed Markdown filesystem ("memfs"), not DB rows:
  - `letta-code@4d5928b1d0:src/agent/memory-filesystem.ts` (`MEMORY_FS_ROOT=".letta"`, `system/` dir)
  - `src/agent/memory-git.ts`
  - `src/agent/memory-worktree.ts`
- A **reflection subagent** reviews transcripts and edits memory and skills. It works only through
  `Bash, Edit` on `$MEMORY_DIR` (`src/agent/subagents/builtin/reflection-v2.md`, verified).
- That subagent runs under a confinement launcher (`src/memory-confinement.ts` →
  `createMemoryConfinementLauncher`, verified).
- Older memory blocks were `label/value/limit/read_only`
  (`letta@archive:letta/schemas/block.py`, verified). In the new layout, core blocks are files under
  `system/`.
- **Pattern value:** memory is inspectable, editable and reversible through git history, and the
  learner is confined to the memory directory.

**Mem0**

- `add()` is now **additive-only**: one LLM call with `ADDITIVE_EXTRACTION_PROMPT`, whose "Your sole
  operation is ADD" (`mem0@a330119bda:mem0/memory/main.py:881-1100`, `mem0/configs/prompts.py:468`).
- The old ADD/UPDATE/DELETE/NONE prompt (`DEFAULT_UPDATE_MEMORY_PROMPT`, prompts.py:176) is still in
  the file, but the main `add` path no longer uses it.
- Three useful details:
  - Existing memory UUIDs are mapped to small integers before the LLM sees them
    ("anti-hallucination", main.py:935-940).
  - MD5 content-hash dedup (main.py:1012-1030).
  - A SQLite `history` table records old/new value per event (`mem0/memory/storage.py`).
- Retrieval is hybrid. `mem0/utils/scoring.py:score_and_rank` combines semantic, BM25 and entity
  boost with an adaptive divisor. A semantic threshold gates candidates before the scores combine.
- **Caveat:** telemetry defaults to `True` and sends to `us.i.posthog.com`
  (`mem0/memory/telemetry.py:9-16`).

**Graphiti**

- Bi-temporal edges carry `valid_at`, `invalid_at` and `expired_at`.
- `resolve_edge_contradictions` (`graphiti@fbf38693df:graphiti_core/utils/maintenance/edge_operations.py:795-829`)
  never deletes. A contradicted older fact gets `invalid_at = new.valid_at` and `expired_at = now`.
- **Pattern value:** temporal supersession instead of overwrite. This gives "what was true when"
  and makes undo trivial.
- **Cost:** a graph DB plus an LLM call per edge for timestamp extraction (`_extract_edge_timestamps`).

**Cognee**

- A Python pipeline: `add → cognify → memify` (`cognee@c78a56ff4a:cognee/modules/{cognify,memify,pipelines}`).
- Defaults: Kuzu graph, a vector store, and a SQLite cache.
- Telemetry is on unless `TELEMETRY_DISABLED` is set (`cognee/shared/utils.py:524,575`).
- No pattern here beats OpenClaw or Letta for CMDeck. **Reference only.**

**OpenClaw** (the closest match to the brief's §9.4 wishes)

- Memory is Markdown in the workspace (`docs/concepts/memory.md`):
  - `USER.md` holds the profile.
  - `MEMORY.md` holds curated facts.
  - `memory/YYYY-MM-DD.md` holds daily notes.
  - `DREAMS.md` holds consolidation output for human review.
- These files are indexed into **per-agent SQLite**:
  - FTS5 for keyword search.
  - Optional embeddings, with optional **sqlite-vec** run in a separate read-only process.
  - Hybrid scoring with recency decay and MMR (`docs/concepts/memory-builtin.md`).
- Defaults (`openclaw@f57a32938b:src/agents/memory-search.ts:163-170`, verified):
  `vectorWeight 0.7, textWeight 0.3, candidateMultiplier 4, mmr.lambda 0.7, temporalDecay.halfLifeDays 30`.
- **Memory-poisoning defense:**
  - Every chunk carries DB-owned provenance: an `origin` class (`owner|agent|untrusted|system`),
    session kind, observation time and a supersession key.
  - This is stored **separately from the Markdown, so recalled prose cannot rewrite its own trust
    class**.
  - Untrusted-origin `MEMORY.md`/`USER.md` are excluded from automatic context (quarantine)
    (`docs/concepts/memory-builtin.md`, `docs/concepts/memory-provenance.md`;
    code in `src/agents/memory-write-provenance.ts`, `src/commands/doctor-memory-provenance.ts`).
- `memory forget --session … --dry-run` removes artifacts derived from a session using lineage.
- Local embeddings are supported via GGUF/llama.cpp or any OpenAI-compatible `/v1/embeddings`
  (`memory-builtin.md:92-127`). The default is OpenAI, which is a privacy caveat.

**Hermes Agent**

- The `memory` tool (`hermes-agent@c925e8bbc4:tools/memory_tool.py`, verified) writes `MEMORY.md`
  and `USER.md` with `add/patch/remove`.
- These files enter the system prompt as a **frozen snapshot at session start**. Mid-session writes
  never change the prompt, which preserves the provider prefix cache.
- Writes pass through:
  - an injection/exfiltration scanner (`tools/memory_tool_store.py:_scan_memory_content`, scope
    "strict");
  - a write-approval gate that can **stage** writes for user approval (`_gate_or_stage`).
- **Weakness found:** the gate "fails open if the gate module can't load" (memory_tool.py:84-90).
  CMDeck must fail closed.

### Is SQLite + FTS5 + local embeddings enough? **Yes.**

- CMDeck already runs FTS5 on `node:sqlite`
  (`cmdeck@4a2f27d590:apps/server/src/persistence/Migrations/069_ThreadMessageSearch.ts:24-28`,
  `tokenize='trigram remove_diacritics 1'`; driver `persistence/Sqlite.ts:11`).
- Memory corpora are small: thousands of entries, not millions. Brute-force cosine similarity over
  `Float32Array` BLOBs in JS is enough at that size.
- Add `sqlite-vec` (Apache/MIT, loaded via `node:sqlite` `allowExtension` + `loadExtension`) only
  when measurements show a need. `Sqlite.test.ts:154` shows extensions are currently disabled.
  sqlite-vec's release cadence is slow (v0.1.9, March 2026), which is another reason to defer it.
- Embeddings can come from the existing local providers (CMD-07: Ollama/LM Studio/llama.cpp
  `/v1/embeddings`), with an optional cloud provider. With no embedder configured, use keyword-only
  search, as OpenClaw does.
- No graph DB and no vector DB are needed. Graphiti's temporal model fits in three nullable columns.

### Pattern CMDeck should copy (composite)

1. **Source of truth:** Markdown files per scope, as in Letta, OpenClaw and Hermes:
   - global `USER.md`;
   - project `MEMORY.md` and `lessons/` (MEM-04);
   - bot-private directory (MEM-05);
   - session/temporary scratch that is never indexed when incognito (MEM-06).
   - Users edit these files directly (MEM-02). Version them with a local git repo or a SQLite
     `memory_history` table (Mem0's history pattern) so every change is reversible.
2. **Index:** an SQLite table per chunk plus an FTS5 virtual table plus an optional `embedding BLOB`.
   - Columns: `scope, origin_class, source_thread_id, observed_at, valid_at, invalid_at,
     superseded_by, importance, last_recalled_at`.
   - Hybrid score (OpenClaw weights) × recency decay with a 30-day half-life (MEM-08), then MMR.
3. **Extraction:** additive-only, as in Mem0.
   - Contradictions are not deleted. Set `invalid_at`/`superseded_by` (Graphiti).
   - Dedup by content hash.
   - Show the model integer IDs, not UUIDs.
4. **Write policy (poisoning defense, §9.4):**
   - Provenance is stored outside content (OpenClaw).
   - Run a pattern scanner on writes (Hermes).
   - Writes derived from tool output or external content are `untrusted` and **staged for approval,
     never auto-injected** (Hermes staging + OpenClaw quarantine).
   - The gate **fails closed**.
   - Frozen-at-session-start injection preserves prompt caching (Hermes).
5. **Self-learning (MEM-03/09):**
   - A background reflection pass works like Letta's reflection subagent or Hermes's
     `background_review.py`. It runs as a CMDeck workflow step with an auxiliary or local model, and
     a tool allowlist confined to the memory/skills directories.
   - Skill creation uses OpenClaw's Skill Workshop modes `auto | propose | off`: every change is
     recorded and undoable, and skills unused for 30 days are archived
     (`extensions/skill-workshop/openclaw.plugin.json`, verified).
   - Hermes's curator follows the same invariants: "never delete, only archive", and pinned skills
     are exempt (`agent/curator.py`).
   - **Default to `propose`** to satisfy "inspectable, editable and reversible".

**Recommendation:** copy the pattern. Mem0, Graphiti, Cognee and Letta are all **reference only**
(Python or retired, telemetry, extra services).

---

## 3. Persistent agents & messaging (AGT-02, AUT-01/03/04, AUT-07, MSG-01..03, MEM-09)

| Concern                 | OpenClaw                                                                                             | Hermes Agent                                                                                                                                                                 | Letta Code                                                                | Take for CMDeck                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent identity          | Per-agent workspace and per-agent SQLite (`~/.openclaw/agents/<id>/…`)                               | Profile-scoped home (`get_hermes_home()`)                                                                                                                                    | Agent ID + memfs dir                                                      | A bot = a CMDeck project-like record with its own memory scope, its own thread(s), and a policy                                             |
| Scheduled agents        | "Automations" (cron) with run history and delivery targets (`docs/automation/cron-jobs.md`)          | `cron/` scheduler with delivery queue and missed-run handling                                                                                                                | `src/cron/`                                                               | **CMDeck already has** `scheduledTasks/` (cron, interval, webhooks, dedupe) and `scheduling/Scheduler.ts`; extend it, don't add a framework |
| Heartbeat               | **Retired heartbeat into ordinary automation jobs** (`docs/gateway/heartbeat.md`, verified)          | inactivity-triggered curator, no daemon                                                                                                                                      | —                                                                         | Model AUT-03 as a scheduled task with a deterministic precheck, not as a separate subsystem (supports §9.5 "no mandatory inference")        |
| Quota recovery (AUT-07) | —                                                                                                    | `cron/quota_hold.py` (verified): parse provider `retry after N`, park `next_run_at` at the window boundary, mark `quota_hold_until`, clear on the next successful model call | —                                                                         | **Copy this pattern.** CMDeck already knows reset times (Usage → Limits), so it can park on the reported reset without parsing errors       |
| Messaging gateways      | `extensions/{telegram,slack,msteams}` on **grammy 1.46, @slack/bolt 5.1, @microsoft/teams.apps 2.1** | `plugins/platforms/{slack,telegram,teams,…}` (Python)                                                                                                                        | `src/channels/` (TS). Includes `access-control.ts` with `dmPolicy` (`open | allowlist                                                                                                                                   | pairing`) → `allow | deny | pair` | **Adopt** grammy + @slack/bolt (TS, MIT). Copy Letta's pairing/allowlist **access-control** model. Telegram long-polling and Slack Socket Mode need **no inbound port**. Teams needs a public HTTPS endpoint (use the CMD-04 tunnel) |
| Skill self-creation     | Skill Workshop (auto/propose/off, undo, 30-day archive, lint)                                        | `tools/skill_manager_*`, `skills_guard.py`, `skill_provenance.py`, curator                                                                                                   | reflection subagent + `creating-skills` skill                             | See §2.5                                                                                                                                    |

Framework adoption is not warranted. Both projects are full assistant products with hundreds of
unrelated features: OpenClaw alone has more than 150 extensions. Copy the four patterns above and
the two messaging SDKs.

---

## 4. Durable execution (AGT-05, AGT-06, INF-03, INF-04)

### What CMDeck already has (verified)

- `apps/server/src/workflows/*` runs on **Effect's durable workflow engine**:
  - `import { Activity, DurableClock, DurableDeferred, Workflow, WorkflowEngine } from "effect/workflow"`
    (`workflows/workflow.ts:15`);
  - cluster-backed engine (`WorkflowEngine.ts:1344-1345`).
- Journaled steps (`journaled(...)`, workflow.ts:188) are replayed from the engine journal.
- Persistent tables (`Migrations/110_Workflows.ts`):
  - `workflow_runs` with a unique idempotency key, `parent_run_id` and `held`;
  - `workflow_steps` (per-step `attempts`, `result_json`, `thread_id`, `turn_id`);
  - `workflow_waits` (durable human or PR waits, with a `woke_json` crash-safe wake).
- A failed step **pauses the run** (`StepFailed`, workflow.ts:37). Resume replays the journal and
  re-executes only the failed step (comment at workflow.ts:199-200, "Only a resume, which unpauses
  first, may").
- `resumeAfter` provides auto-resume backoff (workflow.ts:847, 945).
- In effect this is Temporal/Trigger.dev-style memoized-step replay with selective retry
  (AGT-06 partial: the per-step "retry from here" UX still needs a check against Kiro's semantics).

### Contrast with the libraries

| Library       | Core mechanism                                                                                                                                                                                                                                                                                                                                                     | Fit                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal      | Event history + deterministic replay of workflow code; activities retried by policy                                                                                                                                                                                                                                                                                | CMDeck's Effect engine already implements this model in-process. A Temporal server (Go + DB) is unjustified. **Reference only**                                                                                                                                |
| Trigger.dev   | Run engine with execution snapshots, waitpoints, attempt system and checkpoints (`internal-packages/run-engine/src/engine/systems/{checkpointSystem,waitpoint*,runAttemptSystem,executionSnapshotSystem}.ts`, verified names)                                                                                                                                      | Hosted-scale design. Self-hosting needs Postgres/Redis and more (inferred). **Reference only.** The idea worth reusing is "waitpoint tokens", and `workflow_waits` already provides it                                                                         |
| LangGraph     | Checkpointer: `checkpoints(thread_id, ns, checkpoint_id, parent_checkpoint_id)` plus `writes(task_id, idx, channel)`. **Pending writes** let a failed super-step re-run only the failed tasks (`libs/checkpoint/.../base/__init__.py:301-344`, `checkpoint-sqlite` schema, verified)                                                                               | Python. The _pending-writes_ idea maps to CMDeck's per-step `result_json`; no dependency. **Reference only**                                                                                                                                                   |
| OpenHands SDK | Append-only `EventLog` with parent links and `path_to_root`/`walk_back` for branching (`software-agent-sdk@7cfef13a0a:openhands-sdk/openhands/sdk/conversation/event_store.py`). **`StuckDetector`** has five deterministic loop checks: repeating action/observation, repeating error, monologue, alternating, context-window error (`stuck_detector.py:133-476`) | CMDeck's orchestration-v2 event store already covers the event log. **Copy StuckDetector** (NEW-B03)                                                                                                                                                           |
| Symphony      | Spec for an issue→workspace→agent daemon. One serialized orchestrator authority, `claimed`/`running` checks before dispatch, reconciliation before every tick, backoff `min(10000·2^(n-1), max)`, restart recovery from tracker + filesystem **without a DB** (`symphony@be10a1b79d:SPEC.md §7.4, §8.4`)                                                           | Good **acceptance/spec reference** for AGT-01 Task Runner and issue-to-PR flows. CMDeck has issue-tracker bindings (`IssueTrackerBindings.ts`, migration 109). Its in-repo `WORKFLOW.md` contract parallels CMDeck workflow files. **Reference only** (Elixir) |
| AutoGen       | Archived                                                                                                                                                                                                                                                                                                                                                           | **Incompatible** (unmaintained)                                                                                                                                                                                                                                |
| CrewAI        | Role/crew framework, Python, telemetry module                                                                                                                                                                                                                                                                                                                      | **Reference only**                                                                                                                                                                                                                                             |

**Conclusion:**

- No durable-execution dependency is warranted. CMDeck's Effect workflow engine is already a
  journaled, replaying engine on its own SQLite.
- Remaining gaps are UX and policy:
  - retry from a chosen step;
  - surfacing `attempts`;
  - a stuck detector.
- Keep the §9.3 distinction. A workflow replay restores _orchestration state_, not process memory.
  Git checkpoints restore _files_. Neither restores a running agent's in-process state.

---

## 5. Browser & computer use (TLS-01, TLS-02, DEV-04, DEV-05)

### What CMDeck already has (verified)

- `apps/server/src/preview/ServerBrowser.ts` drives Chromium through `playwright-core@1.64.1`:
  - **CDP screencast** live view (`Page.startScreencast`/`screencastFrameAck`, lines 2410-2423, 3475);
  - **aria snapshots with refs** (`ariaSnapshot`, tests);
  - **human takeover** through `SessionControl` (test: "takeover waits for the running agent and
    revokes snapshot refs before returning control"; "streams to a read-only viewer without allowing
    takeover");
  - recordings;
  - browser contexts (`ServerBrowserContexts.ts`).
- TLS-01 is therefore largely **existing**. The libraries serve as a feature checklist.

| Library        | Model                                                                                                                                                                                                                                                                                                   | Relevant patterns                                                                                                                                                                                                                                                                                                                                                                                                                          | Verdict                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright MCP | Accessibility snapshot + refs; `--isolated` (in-memory profile) vs persistent `--user-data-dir` vs `--extension` (attach to user's Chrome); `--storage-state`; `--caps vision,pdf,devtools`; `--allowed-origins` explicitly "_not_ a security boundary" (`playwright-mcp@2337aff021:README.md:410-525`) | `index.js` is a two-line re-export of `playwright-core/lib/coreBundle` `tools.createConnection`, so CMDeck already ships the same engine                                                                                                                                                                                                                                                                                                   | **Reference only.** Copy the three profile modes and the honest wording about security boundaries                                         |
| agent-browser  | Rust CLI daemon over CDP, one daemon per `--session`; snapshot refs; `stream`/`dashboard`                                                                                                                                                                                                               | **Security model worth copying** (`docs/content/docs/security.mdx`, verified): domain allowlist that also blocks WebSocket/EventSource/sendBeacon and **disables WebRTC**; **content-boundary markers with a per-process CSPRNG nonce** around page text; action policy + confirmation gating for eval/download/upload, with auto-deny after 60 s and auto-deny in non-TTY; output caps; **auth vault where the LLM never sees passwords** | **Copy pattern** (NEW-B02, NEW-B06). Its default Chrome-release CVE check makes an outbound request; CMDeck must not copy that by default |
| Stagehand      | `act/extract/observe` over CDP; v4 caching is server-side at Browserbase                                                                                                                                                                                                                                | Hosted upsell                                                                                                                                                                                                                                                                                                                                                                                                                              | **Reference only**                                                                                                                        |
| Browser Use    | Python agent loop; PostHog telemetry                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Incompatible as a dependency** (Python, telemetry); reference for prompts                                                               |
| Screenpipe     | Continuous screen/audio capture + OCR                                                                                                                                                                                                                                                                   | Commercial license                                                                                                                                                                                                                                                                                                                                                                                                                         | **Incompatible.** Do not copy code. Behavioral reference only                                                                             |

### Recommended shared infrastructure

- **One** server-side browser service: the existing `ServerBrowser`. Live Browser (TLS-01), Design
  Tweak (DEV-04) and Design Critique (DEV-05) should all use it:
  - DEV-04 = snapshot + CSS/DOM edit + screenshot diff;
  - DEV-05 = screenshot + aria snapshot fed to a review model.
- Add three profile modes, following Playwright MCP:
  - `isolated` (default for agents);
  - `persistent-per-bot`;
  - `attach-user-browser` (explicit opt-in).
- Add agent-browser's egress allowlist, content boundaries and action confirmation as **policy
  enforced in the service**, not in prompts.
- Computer Use (TLS-02) is a separate OS-level surface:
  - Hermes uses a `plugins/computer_use/cua` adapter (verified dir) and OpenClaw an
    `extensions/cua-computer` adapter.
  - Prefer the provider-native computer-use tool (Claude/OpenAI), executed in a VM or Windows
    Sandbox (CMD-10), with screenshots streamed over the same viewer protocol.
  - Do not use Screenpipe.

---

## 6. Usage, routing & evals (INF-10, AUT-07, TLS-05)

### Subscription usage vs API cost: CMDeck already does both (verified)

- **API-equivalent cost:**
  - transcript scanning plus the LiteLLM price JSON
    (`apps/server/src/usage/UsageService.ts:72-75` fetches `model_prices_and_context_window.json`,
    MIT portion);
  - custom prices (`docs/user/usage.md`).
- **Subscription limits:**
  - Claude: `GET https://api.anthropic.com/api/oauth/usage`
    (`provider/claudeResetCredits.ts:216`, `usage/cliproxyApi.ts:300`) plus streamed
    `rate_limit_event` (`orchestration-v2/Adapters/ClaudeAdapterV2.ts:11141`);
  - Codex: app-server RPC `account/rateLimits/read` (`provider/CodexProvider.ts:711`);
  - Windows `five_hour`/`seven_day` (`provider/claudeUsageLimits.ts`).

### How the references compare

| Tool          | Discovery method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodexBar**  | Claude: OAuth token from `~/.claude/.credentials.json` or the macOS Keychain item `Claude Code-credentials` (with explicit consent) → `/api/oauth/usage` (beta header `oauth-2025-04-20`); CLI `/usage` screen-scrape fallback; claude.ai web cookies. Codex: `account/rateLimits/read` RPC and `chatgpt.com/backend-api/wham/usage`. Gemini: `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`. Cursor: API + local CSV/JSON. About 100 providers (`Sources/CodexBarCore/Providers/*`, verified) | **Same endpoints CMDeck uses.** Reference for providers CMDeck lacks. Avoid browser-cookie scraping (privacy)                                                                                                                                                   |
| **ccusage**   | Parses local Claude/Codex/… JSONL transcripts (`rust/adapters/claude/src/load.rs`, dedupe) and **infers** 5-hour "blocks" from timestamps (`blocks.rs:identify_session_blocks`)                                                                                                                                                                                                                                                                                                                            | A heuristic, not authoritative limits. CMDeck's scanner is a superset. **Reference only.** It has telemetry                                                                                                                                                     |
| **LiteLLM**   | Price map (already consumed). Router strategies: `lowest_cost`, `lowest_latency`, `least_busy`, `lowest_tpm_rpm_v2`, `budget_limiter`, `tag_based_routing`, `complexity_router`                                                                                                                                                                                                                                                                                                                            | `complexity_router.py` docstring: **rule-based weighted scoring, regex/keyword, <1 ms, no external calls**, optional LLM classifier. Copy that idea for TLS-05. `complexity_router/jev_classifier.py` maps provider `"jev"` → `"typesafe"` (see Open questions) |
| **RouteLLM**  | Trained routers (matrix factorization, similarity-weighted, causal LLM)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Stale since 2024-08; needs trained weights. **Reference only**                                                                                                                                                                                                  |
| **Langfuse**  | Tracing/evals platform                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Needs server + DBs (inferred); `ee/` commercial. **Incompatible as an embedded dependency.** It is at most a user-run OTLP target                                                                                                                               |
| **Promptfoo** | Local CLI evals, SQLite results                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PostHog telemetry. CMDeck already has `evals/` (custom Effect harness; `evals/README.md`). **Reference only.** Optional dev tool with `PROMPTFOO_DISABLE_TELEMETRY=1`                                                                                           |

**AUT-07 recommendation:**

1. Use the reset times CMDeck already has (Limits).
2. Add Hermes's quota-hold rule: when every account or fallback for a provider is exhausted, park
   scheduled or queued work at the earliest reported reset instead of re-firing.
3. On reset, enqueue a single recovery fire.

This is deterministic and needs no inference.

**TLS-05 recommendation:**

1. Deterministic rules first (LiteLLM complexity-router style plus budget/limit state from Usage).
2. An optional local classifier behind one typed decision interface (§9.5).
   - OpenClaw's `decisionModel` role offers typed `choice | score | boolean`, plus providers that
     include local ONNX and any `/rerank` endpoint (`docs/concepts/decision-models.md`, verified).
   - **Copy the interface shape**, not the providers.

---

## 7. Devtools & security (DEV-01, INF-05, INF-08, INF-09)

**PR-Agent → DEV-01 / CMD-16 (copy patterns, MIT):**

- Token-budgeted diff packing with soft/hard output buffers and "extended" patches
  (`pr_agent/algo/pr_processing.py:40-41, 211-300`).
- **Deterministic risk checks** "No model call is involved": sensitive paths and risky change shapes
  (`algo/deterministic_risk.py`).
- **Cross-run inline comment dedup**: a SHA-256 fingerprint embedded as an HTML-comment marker
  (`algo/inline_comment_dedup.py`).
- Also present: `merge_verdict.py`, `findings.py`.
- Do not adopt the Python app.

**Aider repo map → TLS-06 context selection (copy pattern):**

1. tree-sitter `tags.scm` defs/refs build a `networkx.MultiDiGraph`.
2. Edge weights: ×10 if the identifier is mentioned, ×10 if it is long snake/camel case, ×0.1 if it
   is private, ×0.1 if it is defined in more than 5 files, ×50 if the referencer is in chat;
   √(ref count) (`aider@5dc9490bb3:aider/repomap.py:485-516`).
3. Personalized PageRank (`:519-529`).
4. Binary search to fit the token budget (`:676-698`).

Port notes:

- A TS port needs `web-tree-sitter` + query files. The `.scm` files keep their upstream licenses
  (mostly MIT, per `aider/queries/tree-sitter-languages/README.md`).
- Personalized PageRank is about 30 lines; no graph library is needed.

**Continue indexing → MEM-10 Knowledge Library (copy pattern, Apache-2.0):**

- Content-addressed incremental indexing: mtime scan → SQLite catalog → `compute/delete/addTag/
  removeTag` per branch tag, with progress marked only after an artifact is written
  (`core/indexing/README.md`, verified).
- Uses FTS5 + tree-sitter snippets + LanceDB.
- Continue main has been quiet since 2026-07-21, so copy the pattern rather than depend on it.

**Tabby:** a self-hosted server (Rust), `ee/` commercial, slowing. **Reference only.**

**OPA → INF-05:**

- CMDeck already has a TS policy layer (`apps/server/src/policy/ManagedPolicy.ts`, "A file this
  build cannot fully enforce stops the server").
- Rego adds a Go binary or a WASM toolchain (`opa build -t wasm` + `@open-policy-agent/opa-wasm`,
  inferred) and a second language for little gain.
- **A typed TS policy (Effect Schema rules evaluated in the tool-call path) is enough.** Keep OPA as
  reference. Borrow its "decision log" idea: record each allow/deny with its inputs in the chained
  audit log (INF-08).

**Isolation → INF-09:**

- **OpenShell** (Rust, Apache-2.0, CNCF):
  - kernel-enforced filesystem, syscall and network policy, with credentials injected only for
    approved endpoints;
  - a **policy prover** flags risky new access before approval;
  - Linux, macOS (Apple Silicon) and WSL2 (experimental); native Windows via Microsoft MXC on a
    separate `windows` branch;
  - anonymous telemetry, opt-out.
- **gVisor:** a Linux-only OCI runtime (`runsc`), usable as `--runtime=runsc` for Docker sandboxes
  (inferred).
- **Recommendation:** no dependency. Offer `runsc` as an optional Docker runtime on Linux hosts, and
  treat OpenShell as an optional _external_ runtime CMDeck can launch agents into (OpenClaw already
  has `extensions/openshell`, which proves the integration is feasible).
- Be honest in the docs:
  - Docker without gVisor is not a strong boundary.
  - Browser domain allowlists are not firewalls (agent-browser and Playwright MCP both say so).
- I found no per-thread Docker sandbox code in `apps/server/src` (grep for `--network`, `runsc`,
  `--cap-drop`). The CMDeck agent owns the CMD-09 status.

**OpenTelemetry → local traces:**

- CMDeck's Effect services already create spans (`Effect.fn("Service.op")`).
- Effect ships its own exporter: `effect/observability/OtlpTracer` ("Exports Effect tracing spans
  over OTLP/HTTP", `.repos/effect/packages/effect/src/observability/OtlpTracer.ts`, verified).
- **Do not add `opentelemetry-js`.**
- For local traces (NEW-B05), either:
  - point `OtlpTracer` at a **user-configured** local collector (off by default, no default
    endpoint); or
  - write a small in-process `Tracer` that stores spans in SQLite or JSONL under `<T3 home>`.

---

## 8. Recommendations per wishlist gap

| ID                                         | Best source pattern                                                                                                                   | Action                                                                | Dependency?                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| MEM-01 Persistent memory                   | OpenClaw Markdown + SQLite index; Hermes frozen snapshot                                                                              | Copy pattern                                                          | No                                                        |
| MEM-02 Editable memory                     | Files + Mem0 `history` table / git (Letta)                                                                                            | Copy pattern                                                          | No                                                        |
| MEM-03 Self-learning                       | Letta reflection subagent; Hermes background_review                                                                                   | Copy pattern (workflow step, confined tools)                          | No                                                        |
| MEM-04 Repo-scoped lessons                 | OpenClaw/Letta scoped dirs                                                                                                            | Copy pattern                                                          | No                                                        |
| MEM-05 Private bot memory                  | per-agent dirs/DB (OpenClaw)                                                                                                          | Copy pattern                                                          | No                                                        |
| MEM-06 Incognito/temporary                 | Hermes frozen snapshot + no-write mode; OpenClaw admission policy                                                                     | Copy pattern: incognito = read-only snapshot, no extraction, no index | No                                                        |
| MEM-07 Semantic search                     | FTS5 (exists) + local embeddings; OpenClaw hybrid weights; Mem0 adaptive score                                                        | Copy pattern                                                          | Optional `sqlite-vec` later                               |
| MEM-08 Memory decay                        | OpenClaw 30-day half-life + Graphiti `invalid_at` supersession                                                                        | Copy pattern                                                          | No                                                        |
| MEM-09 Auto skill creation                 | OpenClaw Skill Workshop (auto/propose/off, undo, archive) + Hermes curator invariants                                                 | Copy pattern; default `propose`                                       | No                                                        |
| MEM-10 Knowledge Library                   | Continue content-addressed indexing                                                                                                   | Copy pattern                                                          | No                                                        |
| AGT-01/05 Task Runner, Dynamic Workflows   | Existing Effect workflows; Symphony spec for issue→run                                                                                | Existing — improve                                                    | No                                                        |
| AGT-06 Selective retry                     | Existing pause/resume re-runs failed step; LangGraph pending writes                                                                   | Existing — improve (retry-from-step UX)                               | No                                                        |
| AGT-02 Persistent Bots                     | OpenClaw/Hermes identity + scoped memory + scheduled tasks                                                                            | Copy pattern                                                          | No                                                        |
| AUT-01 Cron                                | Existing `scheduledTasks/`                                                                                                            | Existing — retain                                                     | No                                                        |
| AUT-03/04 Heartbeat, Monitor Loops         | OpenClaw "heartbeat = automation job"; OpenHands StuckDetector                                                                        | Copy pattern                                                          | No                                                        |
| AUT-07 Quota recovery                      | Hermes `quota_hold.py` + CMDeck Limits reset times                                                                                    | Copy pattern                                                          | No                                                        |
| MSG-01 Slack                               | OpenClaw/Letta use `@slack/bolt` (Socket Mode)                                                                                        | **Adopt dependency**                                                  | `@slack/bolt` (MIT)                                       |
| MSG-02 Telegram                            | `grammy` long-polling                                                                                                                 | **Adopt dependency**                                                  | `grammy` (MIT)                                            |
| MSG-03 Teams                               | `@microsoft/teams.apps` (OpenClaw)                                                                                                    | Adopt dependency (needs public HTTPS via tunnel)                      | `@microsoft/teams.*` (MIT, inferred: license not checked) |
| TLS-01 Live browser                        | Existing ServerBrowser; agent-browser security; Playwright MCP profile modes                                                          | Existing — improve                                                    | No (playwright-core already present)                      |
| TLS-02 Computer Use                        | provider-native CU + VM/Windows Sandbox; Hermes/OpenClaw CUA adapters                                                                 | Reference                                                             | No                                                        |
| TLS-05..08 Jev                             | OpenClaw `decisionModel` typed interface; LiteLLM rule-based complexity router; PR-Agent deterministic risk; OpenHands risk analyzers | Copy pattern (rules first, optional local model)                      | No                                                        |
| TLS-06 Context selection                   | Aider repo map                                                                                                                        | Copy pattern                                                          | `web-tree-sitter` (MIT) if implemented                    |
| DEV-01 Code Review Sage                    | PR-Agent packing, risk, dedup                                                                                                         | Copy pattern                                                          | No                                                        |
| DEV-04/05 Design Tweak/Critique            | Shared ServerBrowser                                                                                                                  | Existing — extend                                                     | No                                                        |
| INF-03/04 Snapshot/restore, crash recovery | Existing workflow journal; Symphony reconciliation-before-dispatch                                                                    | Existing — improve                                                    | No                                                        |
| INF-05 Permission policies                 | Existing TS ManagedPolicy; OPA decision-log idea                                                                                      | Copy pattern                                                          | No (not OPA)                                              |
| INF-08 Audit log                           | OPA decision logs                                                                                                                     | Copy pattern                                                          | No                                                        |
| INF-09 OS sandboxing                       | gVisor `runsc` option; OpenShell external runtime                                                                                     | Reference / optional integration                                      | No                                                        |
| INF-10 Usage limits & alerts               | Existing Limits; CodexBar for extra providers                                                                                         | Existing — improve                                                    | No                                                        |

---

## 9. New proposals (require approval; not roadmap scope)

### NEW-B01 Forget memory by source session

| Field          | Detail                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description    | Record which thread or session each memory came from. `Forget memories from thread X` previews (dry run), then deletes them, and stops re-ingestion |
| Source         | OpenClaw `docs/concepts/memory-provenance.md` (`openclaw memory forget --session … --dry-run`)                                                      |
| Use case       | A thread contained secrets or bad advice, and you want everything learned from it removed                                                           |
| Value          | High for privacy (§10 "memory respects user control")                                                                                               |
| Effort         | S (once MEM-01 stores `source_thread_id`)                                                                                                           |
| UI impact      | One action in the thread menu and in Memory settings                                                                                                |
| Dependencies   | None                                                                                                                                                |
| Maintenance    | Low                                                                                                                                                 |
| Paid?          | No                                                                                                                                                  |
| Duplicates?    | Extends MEM-02                                                                                                                                      |
| Recommendation | **Approve with MEM-01**: the cost is a column plus a query                                                                                          |

### NEW-B02 Untrusted-content envelopes

| Field          | Detail                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description    | Wrap page text, web fetches, PR comments and inbound channel messages in nonce-tagged boundary markers. Provenance stays `untrusted`, so this content cannot become memory or rules without approval |
| Source         | agent-browser `--content-boundaries` (`docs/content/docs/security.mdx`); OpenClaw origin classes                                                                                                     |
| Use case       | Defends against prompt injection through browsing or messaging bots                                                                                                                                  |
| Value          | High (§9.4, §10)                                                                                                                                                                                     |
| Effort         | M                                                                                                                                                                                                    |
| UI impact      | None visible, beyond "staged from untrusted source" badges on memory                                                                                                                                 |
| Dependencies   | None                                                                                                                                                                                                 |
| Maintenance    | Low–medium                                                                                                                                                                                           |
| Paid?          | No                                                                                                                                                                                                   |
| Duplicates?    | Partly overlaps INF-07 and TLS-08                                                                                                                                                                    |
| Recommendation | **Approve.** This is defense in depth only, so document it as not being a boundary                                                                                                                   |

### NEW-B03 Stuck-loop detector for autonomous runs

| Field          | Detail                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description    | Deterministic detection of repeated action and observation pairs, repeated errors, monologues, alternating loops and context-overflow loops. It pauses the run or notifies the user |
| Source         | OpenHands `software-agent-sdk@7cfef13a0a:openhands-sdk/openhands/sdk/conversation/stuck_detector.py` (MIT)                                                                          |
| Use case       | Overnight Task Runner or bot runs that burn quota in a loop                                                                                                                         |
| Value          | High; cheap                                                                                                                                                                         |
| Effort         | S–M                                                                                                                                                                                 |
| UI impact      | "Paused: looping" status                                                                                                                                                            |
| Dependencies   | None                                                                                                                                                                                |
| Maintenance    | Low                                                                                                                                                                                 |
| Paid?          | No                                                                                                                                                                                  |
| Duplicates?    | Complements AUT-03/04 and TLS-07                                                                                                                                                    |
| Recommendation | **Approve**                                                                                                                                                                         |

### NEW-B04 Cross-run review comment dedup

| Field          | Detail                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Description    | Fingerprint each inline review finding and skip findings already posted on earlier runs |
| Source         | PR-Agent `pr_agent/algo/inline_comment_dedup.py` (MIT)                                  |
| Use case       | Re-reviews after each push stop re-posting the same comments                            |
| Value          | Medium                                                                                  |
| Effort         | S                                                                                       |
| UI impact      | None                                                                                    |
| Dependencies   | None                                                                                    |
| Maintenance    | Low                                                                                     |
| Paid?          | No                                                                                      |
| Duplicates?    | Refines DEV-01 and CMD-16                                                               |
| Recommendation | **Approve as part of DEV-01**                                                           |

### NEW-B05 Local execution traces

| Field          | Detail                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description    | Opt-in capture of the server's existing Effect spans to local storage, or to a user-specified OTLP endpoint, plus a simple trace view per turn or workflow run |
| Source         | `effect/observability/OtlpTracer` (already in the Effect dependency); opentelemetry-js as reference                                                            |
| Use case       | Debugging slow turns or failed workflows without any phone-home                                                                                                |
| Value          | Medium                                                                                                                                                         |
| Effort         | M (viewer is most of it)                                                                                                                                       |
| UI impact      | Diagnostics panel                                                                                                                                              |
| Dependencies   | None new                                                                                                                                                       |
| Maintenance    | Medium                                                                                                                                                         |
| Paid?          | No                                                                                                                                                             |
| Duplicates?    | Not on the wishlist; distinct from telemetry (§7.7)                                                                                                            |
| Recommendation | **Defer.** Start with export only, no viewer                                                                                                                   |

### NEW-B06 Agent-invisible browser logins

| Field          | Detail                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description    | Store site credentials in the encrypted vault. The browser service fills login forms itself after an origin check, so the model never sees the password |
| Source         | agent-browser "Authentication Vault" (`security.mdx`)                                                                                                   |
| Use case       | Live Browser or bots that log into dashboards                                                                                                           |
| Value          | Medium–high                                                                                                                                             |
| Effort         | M                                                                                                                                                       |
| UI impact      | Vault entries get a "browser login" type                                                                                                                |
| Dependencies   | Builds on INF-06                                                                                                                                        |
| Maintenance    | Medium (form heuristics)                                                                                                                                |
| Paid?          | No                                                                                                                                                      |
| Duplicates?    | Extends INF-06 and TLS-01                                                                                                                               |
| Recommendation | **Propose after INF-06 lands**                                                                                                                          |

---

## 10. Ledger entries (for the lead to append to `RESEARCH_LEDGER.md` → Log)

```
- 2026-11-26 [competitive-libraries] completed — §7.2–7.5/7.7 library research; 33 repos + 2 follow-ons verified (renames: OpenHands→OpenHands/OpenHands (+software-agent-sdk), pr-agent→The-PR-Agent, ccusage→ccusage/ccusage, screenpipe→screenpipe/screenpipe, OpenShell→ai-openshell/openshell, gvisor→gvisor/gvisor; Letta server retired → letta-code). See research/competitive-libraries.md (high)
- 2026-11-26 [competitive-libraries] decision — no durable-execution dependency: CMDeck workflows already run on effect/workflow with journaled steps, durable waits and pause/resume re-running only the failed step (workflows/workflow.ts:15,188-200; Migrations/110_Workflows.ts) (high)
- 2026-11-26 [competitive-libraries] decision — memory = Markdown per scope + SQLite FTS5 (already used, migration 069) + optional local embeddings; no vector/graph DB; provenance stored outside content; writes from untrusted sources staged, fail-closed (high)
- 2026-11-26 [competitive-libraries] decision — adopt grammy + @slack/bolt for MSG-02/01 (TS, MIT, no inbound port needed); Teams needs tunnel ingress (medium)
- 2026-11-26 [competitive-libraries] question — "Jev" appears to be TypeSafe AI's hosted decision model (OpenClaw extensions/typesafe: "hosted Jev and local System One"; LiteLLM jev_classifier maps jev→typesafe). Kiro agents must verify whether Kiro Crew's Jev calls a hosted service (medium)
- 2026-11-26 [competitive-libraries] conflict — license: screenpipe is now a commercial source-available license; litellm/langfuse/tabby are mixed (enterprise dirs). Telemetry-on-by-default: mem0, graphiti, cognee, browser-use, promptfoo, ccusage, crewAI, OpenShell (high)
- 2026-11-26 [competitive-libraries] proposals — NEW-B01..B06 recorded for approval (n/a)
```

---

## 11. Open questions

1. **What is Jev?**
   - OpenClaw's `extensions/typesafe/openclaw.plugin.json` describes "hosted Jev and local System
     One models".
   - `docs/concepts/decision-models.md` lists `typesafe/jev-latest` and `openrouter/typesafe/jev-1.14`.
   - LiteLLM's `jev_classifier.py` maps `"jev"` → `"typesafe"`.
   - If Kiro Crew's "Jev" is this hosted model, TLS-05..08 must not depend on it. Use a rules-first
     local decision service with optional providers.
   - Kiro-crew agents should confirm this.
2. **Is AGT-06 already done?** Pause → resume already re-runs the failed step. Does Kiro's
   "Selective workflow retry" also mean re-running _succeeded_ steps, or retrying from an arbitrary
   step? If so, CMDeck needs journal invalidation from step N, a non-trivial engine change.
3. **Teams ingress.** Teams bots need a public HTTPS messaging endpoint. Is a Cloudflare Tunnel
   route acceptable for MSG-03, or should Teams use Graph polling (slower, delegated permissions)?
4. **Where do embeddings run?** Should embedding default to the local provider (CMD-07), with
   keyword-only search when none is configured? I recommend yes, so memory never calls a cloud API
   implicitly.
5. **Skill Workshop default mode.** Should it be `propose` (my recommendation) or `auto` with undo
   (OpenClaw's default)?
6. **Unverified details:**
   - Trigger.dev self-host requirements, Temporal storage, gVisor platform support and the OPA WASM
     path come from general knowledge. I did not re-check them in source.
   - Microsoft Teams SDK license was not checked.
