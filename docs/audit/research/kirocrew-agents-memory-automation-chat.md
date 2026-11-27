# Kiro Crew: agents, memory, automation and chat (AGT / MEM / AUT / CHT) and data stores

Research note for the CMDeck source audit. Owner: Kiro agent 1 of 2 (the other Kiro agent covers
TLS/INF/DEV/AWS/PRD/MSG). Written 2026-11-26.

- **Repo:** `kirodotdev/KiroCrew` at `b75544f0db` (prerelease `v0.14.0-rc.5`). Read-only clone; nothing
  was run, installed or executed.
- **Citations:** every path is `kirocrew@b75544f0db:<path>`. To keep lines short, `kc/` means
  `src/kiro_crew/`, `web/` means `website/src/`, `spec/` means `docs/system-specs/modules/` and
  `test/` is the root pytest tree. A symbol follows the path where it matters.
- **Method:** the four feature groups were read in parallel by delegated read-only passes that
  opened source files, and their key claims were then spot-checked by hand. The spot-checks
  covered every default, constant, path and schema quoted in the summary tables (for example
  `vector_memory.py:_DEFAULT_DECAY_RATE = 0.03`, `history_consolidation.py:_CONSOLIDATION_THRESHOLD = 30`,
  `config/memory_sections.py` gate defaults, `memory_schema.py` `memory_items`,
  `taskrunner.py:574 retry_from_task`, `workflows/service.py:1665 rerun_subtree`,
  `workflows/runner.py:1535 exec(`, `history_schema.py` `queued_prompts`/`forked_from`,
  `history_index.py:409` FTS5, `taskq/store.py:437 tasks.db`, `beacon.py`,
  `config/sections_telemetry.py`). Claims taken only from Kiro's docs are marked **(docs-only)**.
  Test files were only read, never run, so "meaningful" is a reading judgment.

## 1. Kiro Crew architecture in brief (shared with the other Kiro agent)

- **Shape.** One Python asyncio/aiohttp process, the "gateway" (`kc/`, about 5,200 `.py` files and
  2.7M lines including vendored code). It serves a React/Vite/Redux SPA (`website/`, plus an Electron
  shell in `website/electron/`), a CLI (`kc/cli*.py`) and messaging channels (Slack, Discord,
  Telegram, Teams, WeChat, Feishu, WhatsApp, iMessage and others under `kc/`).
  See `docs/architecture/overview.md`.
- **Agent runtime.** Kiro Crew is "ACP-provider-only". It drives a harness process over ACP
  (JSON-RPC 2.0 on stdio): by default KAS (`kiro-cli acp --agent-engine v3`), with the Kiro CLI and
  other ACP harnesses as alternatives (`kc/agent_sdk/backends.py` `DEFAULT_ACP_BACKEND`,
  `spec/providers.md`). The harness owns the LLM connection, tools, MCP and compaction. Kiro Crew
  adds sessions, memory, scheduling, gating and UI around it. All "LLM work" Kiro does itself
  (memory consolidation, judges, decomposition) is a **billed background turn through that same
  harness**, not a local model (for example `kc/history_consolidation_pass.py:_call_llm` →
  `background_turn(agent="kirocrew-lite")`).
- **Sessions.** Every surface gets a session keyed by an origin-encoded `session_key`, for example
  `cron:<id>`, `subagent:<id>`, `taskrunner:<id>:task<N>`, `wf:<run>:<i>`, `_hb` and `hook:...`.
  Sessions come from a warm pool with idle reaping and a circuit breaker (`kc/session.py`,
  `docs/architecture/overview.md` §Session management).
- **Coordination is in agent configs, not code.** `kirocrew` is an ordinary agent config holding
  the `kirocrew-core` MCP tools (`spawn_run`, `task_run`, `cron_add`, `session_*`, …;
  `kc/mcp_core.py`, `kc/mcp_tools/`). The conductor, worker, mate and heartbeat roles are generated
  agent specs (`kc/agent_materialization/`).
- **Storage.** Everything is under a data home, `~/.kiro/crew` (`kc/config/paths.py`,
  `CONFIG_DIR_NAME`; `KIROCREW_HOME` overrides). It is a mix of JSON and JSONL files written with
  atomic replace and advisory locks, plus about ten SQLite databases (detail in §6).
- **Security model.** An owner lock on channels, then a governance ceiling (`POLICY ∩ PROFILE`),
  then a PreToolUse deny gate (`kc/hooks.py`), then an OS sandbox (`kc/sandbox*.py`), then output
  redaction, then a hash-chained security event log (`kc/sel.py`). These belong to the other Kiro
  agent (INF-05/07/08/09).
- **Code style to avoid inheriting.** Most subsystems are a "facade" module re-exporting
  10–30 split-out owner modules, with patch seams kept for tests (for example `kc/cron.py`,
  `kc/session_control.py`, `kc/autonudge.py`, `kc/_facade_*.py`). Specs run to thousands of lines
  (`spec/crew-mode.md` 6.8k, `spec/subagent.md` 6.1k, `spec/memory-skills-hooks.md` 8.6k). There
  are 8,439 `test/test_*.py` files. The behaviour is often good, but the implementation volume is
  not a model for CMDeck; see AGENTS.md "smallest model that makes the correct behavior
  unsurprising".
- **License.** Apache-2.0 (`LICENSE`), with a `NOTICE` ("KiroCrew, Copyright Amazon.com, Inc. or its
  affiliates"), `THIRD-PARTY-NOTICES` and the bundled OFL OpenDyslexic font. Language differs
  (Python vs TS), so nothing below recommends copying code. If any text is copied (prompt
  wording, schemas, regex lists such as the injection patterns), keep the Apache-2.0 notice and
  carry the NOTICE attribution. "Kiro" is an Amazon trademark, so don't use the name in CMDeck UI
  beyond the importer's source label.
- **Runtime dependencies** (`setup.cfg` `install_requires`, excerpt): `aiohttp`, `httpx[http2]`
  (decision-provider client), `slack-sdk`, `websockets`, `croniter`, `cron-descriptor`, `numpy`,
  `jsonschema`, `markdown-it-py`, `pathspec`, `rjieba` (CJK search), `snowballstemmer`, `tzdata`,
  `yarl`, `multidict`. Vendored llama-cpp-python is in `kc/_vendor/` (embeddings). FAISS is an
  optional accelerator. sqlite-vec is **not** used.

## 2. Agents and autonomous execution (AGT)

Shared engine: **taskq** is one SQLite file at `~/.kiro/crew/tasks/tasks.db` (`kc/taskq/store.py`
`TaskStore`; schema `kc/taskq/migrate.py` `_SCHEMA`/`WORK_SCHEMA`; tables `tasks`, `task_events`,
`meta`, `accepted_work`, `principal_storage`). Rows carry lease/generation fencing, an
`idempotency_key`, `side_effect_class`, `lane` and `wait_json`. TaskRunner steps, subagents and
workflow `ctx.agent()` calls all become taskq rows (`kc/taskq/adapters/runner.py` `RunnerLane`,
`RunnerAdmission`, `adopt_orphaned_rows`). Fairness is weighted round-robin with one lane per root
session (`kc/taskq/lanes.py`). Retry on outside dependencies goes through `kc/taskq/dependency.py`
`DependencyCoordinator`. **This durable queue is the most transferable idea in the AGT group:**
one store that every kind of autonomous work goes through, which matches brief §9.2 "one workflow
and autonomous execution engine".

### AGT-01 Task Runner: Implemented+tested, on by default

- **What it does.** Spec → LLM decomposition into ordered or parallel-grouped steps (or a YAML plan
  that skips the LLM: `kc/task_planner.py` `decompose`, `decompose_yaml`, `group_parallel_tasks`,
  `_check_acyclic`). Each step runs in a **fresh ACP session** (`taskrunner:{id}:task{N}`, plus
  `:decompose` and `:review`).
- **Per-step behaviour.** Test-command verification, retries (`MAX_RETRIES=3`), bounded replan
  (`MAX_REPLAN=2`), self-review, git commit or revert per step, pause/resume and a watchdog
  (`kc/task_models.py`; `kc/taskrunner_parts/run_steps.py` `_execute_tasks`, `_try_replan`,
  `_watchdog_loop`; `kc/task_executor.py` `execute_task`, `self_review`, `run_tests`).
- **Storage.** A `runs.json` registry in the work dir (atomic, fsync), a `TASK_PROGRESS.md`
  checkpoint, and taskq rows prefixed `taskrunner:` (`kc/taskrunner_parts/taskq_bridge.py`).
- **Surfaces.**
  - UI: `web/pages/ProjectsPage.tsx`, `ProjectDetailPage.tsx`.
  - HTTP: `/api/taskrunner*` (start, plan, execute, pause, cancel, `{id}/retry`, `refine`,
    `plan.yaml`, `from-chat`/`to-chat`).
  - MCP: `task_run` (`kc/mcp_tools/control.py`).
  - Switch: `taskrunner.enabled=True` (`kc/config/service_sections.py` `TaskRunnerConfig`).
- **Tests.** `test/test_taskrunner_retry_admission.py` injects I/O failures and asserts that every
  field is restored (meaningful). Also `test/test_taskrunner_v2_scenarios.py` (32 tests) and
  `test/test_taskrunner_taskq_bridge.py`.
- **Assessment.** The behaviour is real and useful: plan, then edit, then execute; a fresh session
  per step; a test gate; retry from step N; bounded replan. The 1.9k-line `task_executor.py`,
  per-home `runs.json` adoption (`_adopt_home_rows`) and the leftover `projects` naming are
  accidental complexity.
- **Recommendation: native reimplementation as a workflow preset**, not a separate app (brief
  §9.2). A Task Runner run = a plan document plus a workflow whose steps are child threads, with
  a verification command and a "retry from step N" action. CMDeck's T3 orchestration already has
  threads, worktrees and git checkpoints; reuse them for step isolation and revert.

### AGT-02 Persistent Bots ("Bots" / "Crew Members" / "crewmates"): Implemented+tested

- **What a Bot is.** A named agent in `config.json` `agents.<name>`. Each Bot has:
  - a pinned DM thread (slot mode `member`);
  - its own workspace;
  - a private V2 memory store (MEM-05);
  - a model and harness pin (`kc/crewmate_harness.py`);
  - goals and key results (`kc/member_goals.py`);
  - a notes file `members/<slug>/briefing.md` (`kc/member_notes.py`);
  - permanent rules (`kc/members_parts/prompt_layers.py`).
- **Agent specs.** Chat runs on `kirocrew-mate-conductor`. Hand-offs run on `kirocrew-mate-worker`
  (`kc/mate_worker.py`).
- **Storage.**
  - `~/.kiro/crew/members/<slug>/activity.jsonl` and `briefing.md`.
  - `member-records/{member-rules,member-goals,member-bindings}/<slug>.json` (`kc/member_records.py`).
  - Spec copies in `~/.kiro/mates/agents/<id>.json` plus `owners.json` and `owners.lock`
    (`spec/crew-mode.md`, **(docs-only)** for the lock detail).
  - Teams in `crew-teams/teams.json` (`kc/crew_teams.py`).
- **Waking.** Self-wake is by gateway-owned cron jobs in `crons.json`: a heartbeat and the
  daily/weekly/monthly goal check-ins (`kc/dashboard/handlers/member_goals.py`), plus a work-ledger
  patrol loop via autonudge and app wakes (`POST /api/members/{slug}/wake`).
- **Surfaces.** UI: `web/pages/members/MembersPage.tsx` (about 100 files). MCP server
  `kirocrew-mate` (`kc/mcp_mate.py`: `set_goal`, `save_notes`, `propose_memory_changes`, …).
- **Tests.** `test/test_mate_worker.py` (46 tests), `test/test_member_default_patrol.py` (checks
  that unattested binds are refused; meaningful), `test/test_mate_conductor_every_create_path.py`.
- **Assessment.** Worth porting: a named persistent agent = system prompt + pinned thread +
  private memory scope + optional schedule, and memory-cleanup proposals the owner ticks to apply.
  Do not inherit: the spec copy-and-repoint into `~/.kiro/mates` with cross-instance owner locks,
  the facade mirrors, or pinned-fs/O_NOFOLLOW per member folder.
- **Recommendation: adapt.** One agent/bot registry (brief §9.2): a "bot" is a saved agent profile
  bound to a project, a pinned thread, a memory scope (`bot:<id>`) and zero or more scheduled
  tasks. No new runtime.

### AGT-03 Conductor mode: Implemented+tested; new chats in conductor mode is off by default

- **What it does.** A composer chip moves a chat onto a conductor template
  (`agent.crew_mode_agent`, default `kirocrew-conductor`). The chat locks after the first message.
  The conductor dispatches worker sessions with `session_create`/`session_send` and never does the
  work itself.
  - Code: `kc/crew_mode.py` (`conductor_agents`, `stamp_rows`, `mate_workers_of`).
  - Specs: `kc/agent_materialization/conductor_agents.py` (goal, pipeline and security conductors;
    no write tool; `execute_bash` never auto-approved).
- **Wake rule.** `kc/conductor_wake.py` subscribes to the crew-log bus and wakes the conductor
  **only on a structured worker report** (`done`, `blocked`, `question`), not on every turn end.
  `kc/ledger_wake.py` is the pure decision. `kc/conductor_patrol.py` `ensure_patrol` arms a default
  work-ledger patrol loop.
- **Storage.** No store of its own: slot stamps (`crew_mode_agent`, `crew_root`), the work ledger
  (AGT-07) and `work-ledger/crew-pause.json` (`kc/crew_pause.py`, "Pause all").
- **Surfaces.**
  - UI: `web/pages/CrewBoardPage.tsx`, `web/pages/chat/command-center/ConductorModeCrewPanel.tsx`.
  - HTTP: `/api/crew-board`, `/api/crew-workers`, `/api/crew-timeline`
    (`kc/dashboard/handlers/crew_workers.py`).
- **Tests.** `test/test_conductor_wake.py` (50 tests) and `test/test_conductor_patrol.py` (31) are
  meaningful. `test/test_crew_mode.py` is weak (one prompt string-match).
- **Assessment.** Keep three rules: wake only on structured reports; closing the conductor closes
  its workers; workers are hidden from the person's list. Avoid four conductor variants, two root
  kinds (`crew_root` vs `mate_root`) and remote dispatch (preview, `kc/remote_dispatch.py`).
- **Recommendation: workflow preset.** A conductor is a thread whose agent profile has
  thread-create, thread-send and work-item tools but no write tools, plus a wake-on-report rule.
  Check first whether upstream T3 `delegate_task`/linked threads already cover dispatch (CMDeck
  agent).

### AGT-04 Parallel subagents: Implemented+tested

- **What it does.** `spawn_run` with a `tasks` array starts a "wave", auto-batched past the
  concurrency cap. `spawn_sub_agents` blocks until all finish. A post-fan-out synthesis turn
  summarises the results (`spec/subagent.md` §Post-fan-out Synthesis Turn).
  - Code: `kc/subagent.py` `SubagentManager`, `compute_memory_sized_parallel_cap`;
    `kc/subagent_manager/waves.py` `WaveDigestCoordinator`.
- **Admission.** Rows are written before the call is acknowledged, then run under a lease. Low
  memory defers the wave instead of refusing it (`kc/subagent_manager/admission/`).
- **Concurrency cap.** `agent.max_subagents` (0 = auto-sized from memory). An AIMD controller runs
  every 5 s (`kc/adaptive/controller.py` `AdaptiveController`, `kc/adaptive/policy.py`
  `AdaptivePolicy`; default mode `aimd`).
- **Storage.** `~/.kiro/crew/subagents/<id>/state.json` plus tombstones
  (`kc/subagent_persistence_layout.py`). Scheduling truth is the taskq rows.
- **Surfaces.**
  - MCP: `spawn_run`, `spawn_continue`, `spawn_steer`, `spawn_release`, `spawn_list`,
    `spawn_status`, `spawn_sub_agents`, `resource_status` (`kc/mcp_tools/spawn.py`).
  - HTTP: `/api/spawn*`.
  - UI: chat task cards (`web/pages/chat/subagentQueuedReason.ts`).
- **Tests.** `test/test_adaptive_policy.py` (79), `test/test_taskq_admission_integration.py` (41),
  `test/test_subagent_wave_clock.py` (wall-clock jumps). All meaningful.
- **Assessment.** Port: write-before-ack admission, defer under memory pressure, per-root fairness
  lanes, and the synthesis turn. Avoid: 13 coordinator modules of 1–2k lines and the AIMD
  controller; a fixed cap plus a memory floor is enough to start.
- **Recommendation: adapt.** Many providers in CMDeck have their own native subagents
  (harness-provided). The CMDeck-level feature is "fan out N child threads and join", which belongs
  in the shared workflow engine.

### AGT-05 Dynamic Workflows: core Implemented+tested; built-in app hidden and default-off

- **What a workflow is.** An LLM-authored **Python module**: a `META` literal plus
  `async def workflow(ctx)`. Combinators: `ctx.agent()`, `ctx.parallel` (waits for all; a failure
  becomes `None`) and `ctx.pipeline` (no barrier between stages). `ctx.workflow()` (nesting)
  raises `NotImplementedError`.
  - Code: `kc/workflows/dsl.py`, `kc/workflows/runner.py` `_RunContext`, `WorkflowRunner`;
    `kc/workflows/service.py` `WorkflowService`; `kc/workflows/registry.py` `RunRegistry`.
- **Execution.** In the gateway process: static AST checks (`kc/workflows/validate.py`), then
  `exec(compile(...))` restricted to `SAFE_BUILTINS` (`kc/workflows/runner.py:1535`,
  `kc/workflows/context.py`).
  - Each agent call is session `wf:{run}:{i}` from a warm `WorkerPool` (`kc/workflows/agent_pool.py`).
  - Concurrency 4. Default timeout 3600 s, clamped to 60–21600 s (**(docs-only)** for the numbers,
    `spec/workflows.md` §Configuration).
- **Storage.** One redacted, owner-only JSON per run at `~/.kiro/crew/workflows/runs/<run_id>.json`,
  with its event journal inside (`kc/workflows/store.py` `WorkflowRunStore`). The saved-definition
  library is JSON files (`kc/workflows/library.py`).
- **Surfaces.**
  - MCP: `workflow_author`, `workflow_run`, `workflow_status`, `workflow_result`, `workflow_list`,
    `workflow_cancel`, `workflow_rerun_subtree`, `workflow_library_list`
    (`kc/mcp_tools/workflows.py`).
  - HTTP: `/api/workflows/*`.
  - UI: `web/components/workflows/` (Tree and planned-graph views); `web/apps/workflows/` is the
    hidden built-in.
- **Tests.** `test/test_workflows_resume.py` counts live agent calls on replay (meaningful),
  `test/test_workflows_malicious.py`, `test/test_workflows_conformance.py`.
- **Security finding.** The design runs **model-generated Python inside the privileged gateway
  process**, contained only by an AST blocklist and a builtins allowlist. Do not reproduce this.
- **Recommendation: native reimplementation.** The worthwhile parts are the combinator semantics
  (`parallel` with failure-as-null, `pipeline` without a barrier), a typed event journal per run, a
  run-global semaphore and the planned-vs-actual graph. Represent workflows declaratively (a JSON
  DAG the model can author, validated by an Effect Schema) and interpret it with Effect fibers.
  Check upstream T3 workflow support first (§9.1); if it exists, extend it.

### AGT-06 Selective workflow retry: Partial (three separate mechanisms; none retries "only the failed node")

- **Workflows.** `WorkflowService.rerun_subtree(run_id, from_index, source=None)`
  (`kc/workflows/service.py:1665`) starts a new run.
  - Calls before `from_index` replay their cached results, **only when a SHA-256 call fingerprint
    matches** (`kc/workflows/runner.py` `_call_fingerprint`, `_CallScope`). Later calls run live.
  - Editing the source turns replay off.
  - Results are saved after each call, so a run interrupted by a restart can be replayed.
  - Reached via MCP `workflow_rerun_subtree` and `POST /api/workflows/runs/{id}/rerun`.
  - Tests: `test/test_workflows_resume.py` (`test_replay_before_reuses_prefix_and_reexecutes_tail`),
    `test/test_bug_service_workflowservice_rerun_subtree.py`.
- **TaskRunner.** `TaskRunner.retry_from_task(task_id, from_task, agent="")` (`kc/taskrunner.py:574`)
  resets steps ≥ N to pending and can retarget the agent (`POST /api/taskrunner/{id}/retry`).
- **Subagents.** `api_spawn_retry` (`kc/dashboard/messaging_api/run_control.py`) starts fresh runs
  for the failed children of a wave.
- **Recommendation: native, built into the workflow engine from day one.** Cache each step result
  keyed by **position path + input/prompt hash** (not call order), and replay matching steps on
  rerun. This gives true "retry only the failed node" in a DAG, which Kiro's linear index cannot.
  Combine it with CMDeck's per-step git checkpoints, and per brief §9.3 never imply that a
  checkpoint restores a process.

### AGT-07 Work Ledger: Implemented+tested

- **What it is.** A two-writer record between a conductor and its workers, with split field
  ownership:
  - the conductor writes title, acceptance, state and verdict (`apply_conductor_action`);
  - the worker writes status, summary, artifacts and PR (`apply_worker_report`) (`kc/work_ledger.py`).
- **Key invariant: a worker report is data, never a prompt** (`kc/mcp_work.py` docstring). This is
  a good injection boundary.
- **Storage.** `~/.kiro/crew/work-ledger/<conductor>/conductor.json`, `items/it_*.json` plus
  `items/<id>.jsonl` events, and `bindings/<worker>.json`. Locks are taken in a fixed order
  (conductor, then item, then binding) (`kc/work_ledger_store.py`). States: open, accepted,
  rejected, abandoned (`kc/work_vocab.py`).
- **Surfaces.** MCP server `kirocrew-work` (`work_brief`, `work_report`, `work_ledger_read`,
  `work_ledger_record`, `accept_eval`, …). Read by the Crew board.
- **Tests.** `test/test_work_ledger.py` (110 tests: vocabulary, caps, path escapes).
- **Recommendation: native.** One SQLite table (`work_items`: parent thread, child thread,
  acceptance criteria, conductor state, worker status, summary, artifacts) behind an Effect service,
  reachable by MCP tools. Schema-bound worker fields only. Present it as a list in the conductor
  thread's side panel, **not** as a kanban board (boards are excluded, EXC).

### AGT-08 Session Ledger: Implemented+tested

- **What it is.** A durable per-session state record: goal, phase, next step, approaches tried,
  artifacts and recent events. The agent writes it via MCP `session_ledger_record` and reads it via
  `session_ledger_read` (`kc/mcp_tools/ledger.py`).
  - It is re-injected at the head of nudge prompts
    (`kc/dashboard/handlers/autonudge.py` `compose_nudge_body`) and **after compaction**
    (`kc/context_assembly/turn.py` `ledger_reinjection_part`).
  - A phase change must carry a classified event.
- **Storage.** Not a document. It is folded out of `ledger/recorded` entries in the session crew
  log, `~/.kiro/crew/crew-log/sessions/<store>/log.jsonl` (`kc/session_ledger.py` docstring). A
  legacy `ledger/<store>/state.json` is read once and carried forward.
- **Tests.** `test/test_session_ledger.py` (61), `test/test_session_ledger_projection.py` (32).
- **Assessment.** The idea is excellent for long autonomous threads and survives compaction. The
  event-sourced fold with memo caches and slot-key aliasing is not needed.
- **Recommendation: native and small.** A per-thread "state card" row (structured JSON with a
  length cap) written through an MCP tool, injected into scheduled or loop wakes and after
  provider compaction where the adapter can detect it. It fits naturally as a thread-scoped memory
  item (§3 proposal).

### AGT-09 Agent Channels: Implemented+tested; sidebar entry off by default

- **What it is.** A room with an orchestrator and up to N specialist agents
  (`agent.max_channels=1`, `max_channel_agents=3`).
  - Routing: an unmentioned human message goes to the orchestrator; `@mentions` route to
    specialists.
  - Each agent has a listen mode: all, mention or silent.
  - Channel agents are barred from the dispatch and session-control tools
    (`CHANNEL_AGENT_BLOCKED_TOOLS`, `kc/mcp_core.py` `_deny_channel_agent_dispatch`).
  - Code: `kc/channel.py` `ChannelManager`; spec `spec/persistent-agent-channels.md`.
  - Not to be confused with `kc/channels.py`, which is the messaging-transport roster.
- **Runtime.** Each agent is a `run_channel_agent` asyncio task with an inbox queue on its own
  session.
- **Storage.** `<config_dir>/channels/<id>.json` keeps the newest 200 messages plus the channel
  trust grant. On restore, agents come back with fresh sessions.
- **Surfaces.** UI: `web/pages/ChannelPage.tsx`. HTTP: `/api/channels*`. No MCP tools. Visibility:
  `dashboard.channels_enabled=False`.
- **Tests.** `test/test_channel.py` (29, including a routing invariant),
  `test/test_channel_blocked_tools.py`.
- **Recommendation: adapt as a thread variant.** A "room" thread whose messages route to one of
  several bound agent threads by @mention, with dispatch tools denied to the room's agents.
  Low priority: it overlaps conductor mode, and Kiro itself ships it hidden.

### AGT-10 Research Lab ("Auto Research" built-in app): Implemented+tested; defaultEnabled:false

- **What it does.** First grows a "grill" tree of clarifying and research questions, then runs a
  multi-cycle campaign that streams findings until COMPLETE, STAGNANT, STOPPED or FAILED.
  - Attended mode pauses to ask the person.
  - The final rounds are reserved for synthesis (`ceil(max_rounds*reserve_fraction)`).
  - Results export to the Knowledge library or an artifact.
  - Code: `kc/apps/builtins/auto_research/` (`app.json`, `campaign/__init__.py`).
- **Storage.**
  - SQLite `data_home/apps/auto-research/campaigns.db`, table `campaigns`, with migrations as
    `ALTER TABLE` statements (`campaign/storage.py`).
  - Per-campaign folders `workspace/research/<id>/` holding `FINDINGS.md`,
    `subquestion_queue.json` and `workflow_run.json`.
- **Execution.** Two modes: an autonudge loop on a worker slot (`campaign/agent_mode.py`) or a
  workflow template (`campaign/workflow_mode.py`). A watchdog settles runs and expires a 24 h
  auto-approve trust (`campaign/watchdog.py`).
- **Surfaces.** UI: `web/apps/auto-research/ResearchLabPage.tsx`, `GrillTree.tsx`. HTTP:
  `/api/apps/auto-research/*` with a server-sent-events stream.
- **Tests.** `test/test_auto_research_campaign_contract.py` (53), `test/test_auto_research_watchdog.py`
  (23), and `web/apps/auto-research/ResearchLabPage*.test.tsx`.
- **Recommendation: workflow preset (brief §9.2).** A "research" workflow template: a scoping step
  (question tree, human-editable), N bounded research cycles in a child thread, a stagnation stop
  (no new findings in K cycles) and a reserved synthesis step writing an artifact. One execution
  mode only.

## 3. Memory and learning (MEM)

### Memory architecture in one paragraph

Kiro has **two parallel memory lineages**, and that is its biggest accidental complexity.

- **Global V1** (for ordinary chats) is:
  - markdown files `workspace/memory/{preferences.md, projects.md, history/YYYY-MM-DD.md}`;
  - an FTS5 index `memory_index.db`;
  - `memory.db`, holding `semantic_memory` (key/value facts: `pref.*`, `user.*`, `project.*`,
    `lesson.*`) and `episodic_memories` with float32 BLOB embeddings
    (`kc/vector_memory_lifecycle.py` `_SCHEMA_V1`);
  - `lessons.jsonl` (`kc/learn.py` `_LESSONS_FILE`).
- **Member V2** (one per bot) is one SQLite file `memory_stores/<store>/memory.db`
  (`kc/memory_schema.py` `MEMBER_SCHEMA_SQL`/`CREW_SCHEMA_SQL`). It holds:
  - `memory_items` (kind `directive` | `fact` | `episode`, with `scope`, `surface`, `session_key`,
    `importance`, `confidence`, `source`, `embedding` BLOB, soft delete);
  - `memory_history`, `memory_consolidations`, `memory_events`, `memory_meta`, `member_database`
    (identity row);
  - `memory_fts` (FTS5);
  - compatibility views `semantic_memory` and `episodic_memories`.
- **Writes** come mostly from an **LLM consolidation pass through the harness**
  (`kc/history_consolidation*.py`), plus explicit tools/APIs.
- **Reads** are assembled into the prompt under per-block budgets (`kc/context_assembly/`).
- **Pluggable provider.** `kc/memory_provider/` lets an app replace or augment the provider.

**Proposal for CMDeck (input to brief §9.4):** one SQLite table shaped like Kiro's V2
`memory_items`, plus `memory_revisions` and an FTS5 table, with a `scope` column carrying
`global | user | project:<id> | repo:<id> | bot:<id> | thread:<id>`. Incognito and temporary are
**thread modes**, not scopes. No second lineage, no markdown source of truth, no vector DB.

### MEM-01 Persistent memory: Implemented+tested

- **What is stored.** Preferences, projects, daily history summaries, facts, episodes and lessons
  (paths above).
- **Consolidation triggers** (`kc/history_consolidation.py` `HistoryConsolidator`):
  - preferences/projects after `_CONSOLIDATION_THRESHOLD = 30` new messages;
  - daily history after 3 h idle (`memory.history_idle_hours = 3.0`) or at end of day;
  - retries up to 5 times with 900 s → 86400 s backoff.
- **Per-pass caps** (`kc/vector_memory_constants.py`): 20 semantic items, 10 episodic, 10 lessons,
  values ≤ 2000 characters.
- **The consolidation LLM is a billed harness turn.** `history_consolidation_pass._call_llm` uses
  agent `kirocrew-lite` with a fresh conversation. It returns JSON with keys `semantic`,
  `episodic`, `preferences_update`, `projects_update`, `lessons`.
- **Injection into prompts.** `kc/context_assembly/session_start.py` with budgets in
  `kc/context_assembly/budget.py` (for example `_MEMORY_HISTORY_CAP` 16%, `_LESSONS_CAP` 22.6%).
  Fake fences are neutralised first (`kc/context_assembly/markers.py`). On/off switches:
  `memory.inject_memory`, `inject_lessons`.
- **Tests.** `test/test_history_consolidation_bounds.py`, `test_history_consolidation_retry.py`,
  `test_history_consolidation_idle_seed.py`.
- **Recommendation: native reimplementation.** Keep the two triggers (message count and idle), the
  per-pass caps and the per-block prompt budgets. Run consolidation on a **cheap or local model via
  CMDeck's provider layer** (Ollama/LM Studio supported, CMD-07), with the transcript fenced as
  untrusted. Make it opt-in per project.

### MEM-02 Editable memory: Implemented+tested

- **UI.** `web/pages/overview/MemoryTab.tsx` and `MemoryRecordsEditor.tsx`. Per-record history has
  a "restore version" action.
- **HTTP.** `GET /api/memory/records`, `/records/history`, `POST /api/memory/bulk/preview`,
  `/bulk/apply`, `PUT /api/memory/semantic`, `/api/memory/retired[/restore]`
  (`kc/dashboard/routes/memory.py`).
- **Edit engine** (`kc/memory_edit.py`):
  - `preview_edit` returns an HMAC-signed preview (TTL 900 s); `apply_edit` re-reads the selection
    inside one SQLite transaction.
  - Limits: `MAX_BATCH_ROWS = 10000`, `MAX_EXPLICIT_ROWS = 500`.
  - `_PROTECTED_FIELDS` (`scope`, `repo_scope`, `source`, …) cannot be edited.
  - New values are injection-screened.
- **History.** Tables `memory_revisions` (before/after JSON) and `memory_record_meta`
  (`kc/memory_record_metadata.py`). Store backups are kept (`memory.backup_keep = 7`).
- **Bot self-cleanup.** A Bot proposes deletes and edits on a card; only ticked rows apply
  (`kc/change_card_memory.py`).
- **Tests.** `test/test_memory_edit.py`, `test/test_memory_edit_api.py`,
  `web/test/MemoryRecordsEditor.test.tsx`. Meaningful.
- **Recommendation: native.** A memory panel in Settings plus a thread-side "what was remembered
  from this thread" view. Edits go through one service with a revisions table, preview→apply for
  bulk changes, and protected provenance fields. This satisfies brief §9.4 "inspectable, editable
  and reversible".

### MEM-03 Self-learning (lessons): Implemented+tested

- **Detection is by the LLM, not by rules.** The consolidation prompt asks for "corrections the
  user taught" as `{rule, negative, category, repo_scope, applies}`
  (`kc/history_consolidation_pass.py`). Explicit paths: MCP `learn_add`, `POST /api/lessons`, CLI
  `kirocrew learn`.
- **Tiers** (`kc/lesson_validation.py`):
  - `always` renders under `[Learned corrections]`;
  - `on_topic` renders under `[Learned experience]` only when the request overlaps.
  - A lesson with no tier is served as a standing rule.
- **Validation.**
  - `learn.lesson_contains_injection`;
  - `contains_volatile_lesson_fact` (refuses rules that pin a model identity);
  - `scope_is_admissible`.
- **Duplicates.**
  - Render-time fold of near-duplicates at cosine ≥ 0.95 (`kc/memory_lesson_fold.py`, enforced by
    default). The store is not changed.
  - Store dedup for private stores (`memory.member_lesson_dedup="off"`).
  - An offline "dream" proposal pass (`kc/memory_dream.py`, `memory.dream="off"`).
- **Tests.** `test/test_learn.py`, `test/test_memory_tier_policy.py`, `test/test_memory_lesson_fold.py`.
- **Recommendation: native, with stricter defaults than Kiro** (see §3 poisoning). Port the
  always/on_topic split with separate budgets and the render-time fold. Agent-inferred lessons
  should land as **proposals** (pending until the user accepts) or as `on_topic` at most; never
  silently as standing rules.

### MEM-04 Repository-scoped lessons: Implemented+tested

- **Field.** `Lesson.repo_scope: str | None` (`kc/learn.py`). In V2 it is projected into
  `memory_items.scope`.
- **Gate.** `kc/project_scope.py` `project_scope_satisfied(relpath, project_dir)`: a lesson applies
  when the session's project directory or a parent contains the path fragment. It fails closed and
  never uses the process cwd. `SCOPE_FRAGMENT_RE` rejects absolute paths and `..`.
- **Known weakness, noted in Kiro's code.** A vague fragment such as `src` matches every repo.
- **Tests.** `test/test_lesson_project_scope.py`, `test/test_lessons_list_repo_scope.py`.
- **Recommendation: native.** Scope by CMDeck **project id** (and optionally repository remote
  URL), not by path fragments. This also survives worktrees, which path fragments handle poorly.

### MEM-05 Private bot memory: Implemented+tested

- **Storage.** One SQLite DB per member, `~/.kiro/crew/memory_stores/<store>/memory.db`
  (`kc/memory_stores.py` `MEMORY_STORES_DIR_NAME`, `MEMORY_DB_FILE`).
- **Isolation.**
  - Routing uses a captured execution record (`kc/member_memory_auth.py`).
  - The tree is denied to the agent's own file tools.
  - `memory_meta.store_name` and the `member_database` identity row refuse a misplaced file.
  - Kiro's own docstring says this is **not a confidentiality boundary against same-user code**.
- **Retrieval** (`kc/memory_v2.py`). Cosine floors 0.57–0.62, or keyword coverage (at least 2 terms
  and 50%). Score `0.7*cos + 0.3*lexical`, multiplied by `(0.85 + 0.15*importance)`.
- **Tests.** `test/test_member_memory_ownership.py`, `test/test_member_memory_runtime.py`,
  `test/test_memory_v2_isolation.py`; `website/playwright/member-memory.spec.ts`.
- **Recommendation: adapt.** One table with `scope = bot:<id>` and service-level enforcement (a bot
  thread's context reads only `global ∪ project ∪ bot:<self>`). A separate DB per bot is
  unnecessary in CMDeck. Document the same honest limit: same-user code can read the DB.

### MEM-06 Incognito and temporary memory: Implemented+tested

- **Modes.** `kc/execution_context.py` `MEMORY_MODES = ("persistent","incognito","temporary")`
  (`kc/messaging/privacy_mode.py`):
  - **incognito**: memory reads allowed, writes blocked, log discarded on close;
  - **temporary**: no reads, no writes, no persistence.
- **Enforcement points.**
  - The transcript header `memory_mode` (`kc/history_derivation.py` `is_incognito_transcript`).
  - Consolidation refuses `TranscriptWithheld`.
  - `is_restricted_session_key` blocks `learn_add`.
  - Session start skips memory for temporary sessions (`kc/context_assembly/session_start.py`).
  - Injection receipts write nothing for these sessions.
  - It fails closed: an unreadable header counts as restricted.
- **Defaults.** A setting picks the mode for new chats (`web/components/MemoryModeChip.tsx`). A
  fork keeps the mode. "Promote" copies an incognito chat into a persistent one
  (`kc/dashboard/chat_fork.py` `api_chat_slot_promote`).
- **Tests.** `test/test_messaging_privacy_mode.py`, `test/test_messaging_privacy_mode_reservations.py`,
  `web/components/MemoryModeChip.test.tsx`.
- **Recommendation: native.** A `memoryMode` field on the thread (contracts), checked by **one
  predicate** in the memory service that every reader and writer calls. Reverse state (AGENTS.md
  "every way in needs a way out"): offer Promote. Note: a provider's own transcript or memory
  (for example Claude Code's `~/.claude` project memory) is outside CMDeck's control; say so in
  the UI.

### MEM-07 Semantic memory search: Implemented+tested, local inference but default-on model download

- **Model.** `kc/embeddings_settings.py` `_MODEL_ID="qwen3-embedding:0.6b"`, GGUF Q8_0, `_DEFAULT_DIM=1024`,
  SHA-256 pinned. It runs **in-process** through vendored llama.cpp.
- **Download.** About 610 MB from `https://d3j0sthz5doyui.cloudfront.net/models/qwen3-embedding-0.6b.gguf`,
  started automatically in the background (`kc/embeddings_download.py`). Overridable (https only).
- **Optional Ollama backend.** `kc/embeddings_ollama.py`, loopback by default; a remote server
  needs https.
- **Vectors.** float32 BLOBs in SQLite with brute-force numpy cosine. FAISS is an optional
  in-memory accelerator for episodes (`kc/vector_memory_runtime/faiss_index.py`: "SQLite stays
  authoritative"). sqlite-vec is not used.
- **FTS5.** `memory_fts` (porter unicode61) in V1 and V2, `items_fts` (knowledge), and
  `session_fts`/`session_cjk` (chat search).
- **Hybrid ranking.** V1 0.6 vector / 0.4 keyword; V2 0.7/0.3; knowledge uses RRF (k=60).
- **Model changes.** A "vector space signature" triggers re-embedding when the model changes.
- **Tests.** `test/test_embeddings_download.py`, `test/test_embeddings_ollama.py`,
  `test/test_embedding_space_reconcile.py`.
- **Recommendation: native, FTS5 first.** Ship FTS5 BM25 retrieval first. Add embeddings as an
  **opt-in** that uses an embedding model from a configured local provider (Ollama/LM Studio
  `/embeddings`, CMD-07), stored as BLOBs with a model-signature column and brute-force cosine
  (enough below about 100k rows; brief §9.4). **No automatic downloads** (CMD-01).

### MEM-08 Memory decay: Implemented (ranking only, never deletion)

- **V1 episodes** (`kc/vector_memory_runtime/episodic_search.py`):
  - `score = cosine × (0.7 + 0.3·importance) × exp(−rate·days_old)`;
  - `_DEFAULT_DECAY_RATE = 0.03` per day (`kc/vector_memory.py:284`), a half-life of about 23 days;
  - per-tag rates via `memory.decay_rates`; the slowest applicable rate wins.
  - No recall reinforcement: `last_accessed_at` only feeds reporting.
  - Cap of 10,000 episodes; the lowest-importance, oldest rows are evicted.
- **V1 daily history** (`kc/memory.py` `MemoryStore._read_recent_history_uncached`; also in
  `docs/architecture/overview.md`):
  - days 0–13 in full;
  - days 14–60 as header plus first entry;
  - days 61–180 as a one-line count;
  - files deleted after 365 days.
- **V2.** Age-neutral by default. Optional hyperbolic `recency_boost` (half weight at 7 days) and
  `session_affinity`.
- **Tests.** No test file is named for decay. Coverage is inside the episodic and vector tests,
  which were not opened. Confidence medium.
- **Recommendation: native.** Exponential decay as a **ranking factor only**, with per-kind rates
  and none for user-taught directives, plus the tiered summary of old history. Deletion only by
  explicit retention settings.

### MEM-09 Automatic skill creation: Implemented+tested, off by default, approval-gated

- **Pipeline.** After consolidation, `kc/history_consolidation_skills.py` `_run_skill_detection`
  reads the last 200 messages.
  - Eligibility: at least 5 tool calls, and the session touched no sensitive path.
  - Dedup: `find_similar` at 0.85, then an LLM judge.
  - Safety: the LLM's output is redacted (`redact_exfiltration_urls`, `redact_credentials`) and
    generated scripts are checked by `validate_skill_script`.
- **Staging.** Candidates go to `~/.kiro/crew/skills/auto/.pending/<slug>/{SKILL.md, scripts/, .meta.json}`
  (`kc/skills_auto_model.py` `AUTO_PENDING_DIRNAME`), read without following symlinks
  (`kc/skills_candidate_tree.py`). Retired skills go to `.archive`.
- **Review.** HTTP `/api/skills/-/pending[/{slug}/approve|dismiss]`. UI `web/pages/overview/SkillsTab.tsx`.
- **Defaults.** `skills.auto_create_from_sessions=False`, `approval_required=True`,
  `max_auto_skills=100`, stale after 30 days, archived after 90.
- **Related.** Project `.kiro/skills` load only after per-directory consent (`kc/skill_trust.py`).
- **Tests.** `test/test_history_auto_skills.py`, `test/test_skill_pending_api.py`, `test/test_skill_trust.py`.
- **Recommendation: adapt behind TLS-03.** CMDeck's skill format (owned by the other Kiro agent and
  the CMDeck agent) decides the target. Port the **pending queue with mandatory approval**, the
  symlink-safe candidate read, redaction, and the "no sensitive session" eligibility rule. Keep it
  off by default.

### MEM-10 Knowledge Library: Implemented+tested

- **Storage.** `~/.kiro/crew/workspace/knowledge/knowledge.db` (`kc/cli_knowledge.py`). Tables
  (`kc/knowledge/store_parts/schema_migrations.py` `_init_schema`): `sources`, `items` (with an
  `embedding` BLOB), `items_fts`, `entities`, `entity_aliases`, `entity_relations`, `mentions`,
  `source_locations`, `ingestion_jobs`, `folder_file_state`, `vector_generation`.
- **Chunking.** `kc/knowledge/chunker.py`: 800 tokens with 200 overlap, at most 50 chunks per file.
- **Entity extraction.** Through the harness LLM pool, with chunks fenced as
  `<<<BEGIN_UNTRUSTED_CHUNK_{nonce}>>>` (`kc/knowledge/extractor.py`).
- **Retrieval.** `HybridRetriever` fuses FTS, graph and vector results with RRF.
- **Bedrock.** `kc/knowledge/connectors/bedrock_kb.py` queries live, stores nothing locally and
  requires an owner attestation. This overlaps BRK-KB (AWS agent).
- **Defaults.** `auto_ingest_artifacts=False`, `auto_add_documents=False`. A folder watcher keeps
  sources in sync (`kc/knowledge/folder_watcher.py`).
- **Tests.** `test/test_knowledge_chunker.py`, `test/test_knowledge_entity_identity.py`,
  `test/test_knowledge_bedrock_bundles.py`.
- **Recommendation: native, reduced.** Sources (files or folders), chunks, FTS5 plus optional BLOB
  vectors, RRF and nonce fences, exposed as one MCP search tool scoped to a project. Skip the
  entity graph in v1. Bedrock KB is an optional connector behind BRK-KB.

### Memory poisoning (brief §9.4): what Kiro does and what CMDeck should do

**On by default in Kiro:**

- **Regex injection screen** (`kc/vector_memory_constants.py` `_INJECTION_PATTERNS`, with
  invisible-character folding via `_DEFAULT_IGNORABLE_RE`). Applied to episodic, semantic and V2
  writes, lessons, owner edits and provider migration. Stored rows can be audited afterwards with
  `kc/security/memory_audit.py` `scan_memory`.
- **Rule ordering by authority** (`kc/memory_rule_authority.py`, `rule_authority_order="enforce"`):
  user-taught (`source=="user_explicit"`) ranks above agent-inferred. It **only reorders**; nothing
  is dropped.
- **User-origin directive gate** (`kc/directive_origin.py` `USER_ORIGIN_DIRECTIVES`). It covers
  directives like `set_project`, not memory.
- **Fence neutralisation** when memory is injected (`kc/context_assembly/markers.py`), and nonce
  fences for knowledge chunks.

**Off by default** (`kc/config/memory_sections.py`, verified: `default="off"` at lines 544, 560,
575):

- `lesson_origin_gate` (`kc/memory_origin_gate.py` `classify_turn`: `TURN_HUMAN` only when
  `meta.human`, otherwise agent or automatic). Under `enforce`, lessons from spans with no human
  turn are demoted.
- `fact_origin_gate` (`kc/memory_fact_origin_gate.py`). Drops `pref.*`/`user.*` facts from spans
  with no human turn.
- `lesson_tier_policy` (`kc/memory_tier_policy.py`). An `always` lesson needs a verbatim user
  quote.

**Gaps.**

- The consolidation span renders user and assistant text (`kc/history_consolidation_span.py`
  `_fmt_message`), so anything the assistant repeats from tool output or web pages can become
  memory. Whether raw tool results enter the span was not verified.
- Kiro's spec calls long-term poisoning an "accepted residual" (`spec/memory-skills-hooks.md`,
  around line 1711, **(docs-only)**).

**CMDeck recommendation (default-on):**

1. Tag every memory with provenance (`user_explicit | user_confirmed | agent_inferred | imported`)
   and the originating turn kind.
2. Only `user_explicit`/`user_confirmed` items can be standing rules. Agent-inferred items are
   `on_topic` or pending proposals.
3. Never feed tool results or fetched content into the consolidation input; summarise only
   human and assistant prose, and fence it.
4. Run the regex screen as best-effort hygiene, **not** as a boundary (brief §15: model and
   heuristic checks are not enforceable security).
5. Every write is a revision, so it is reversible.

## 4. Automation and scheduling (AUT)

### AUT-01 Cron jobs: Implemented+tested (the most mature subsystem)

- **Schedule kinds.** `every` (≥ 60 s), one-shot `at`, and 5-field `cron` (`kc/cron_service/model.py`
  `CronSchedule`). Each job runs one of: an agent prompt (`message`), a Python function
  (`script`), or a shell `command`.
- **Per-job options.** `persistent_session` (default True; False gives a fresh session per run),
  `timezone`, `skip_dates`, `strict_schedule`, `model`, `agent_id`/`member_id`, `agent_sequence`,
  `timeout_secs`, `project_path`, `new_chat_per_run`, `notify_only`, `managed_by`,
  `delete_after_run`.
- **Failure handling.** Auto-pause after `auto_pause_after_failures` consecutive failures (default
  5), or else exponential failure backoff from 5 min to 1 h (`failure_backoff_until`).
  `last_error_kind` records throttle or capacity.
- **Timer and jitter** (`kc/cron_service/service/wake_timer.py`, `kc/cron_service/schedule.py`):
  - one asyncio timer, capped at `_TIMER_POLL_SECS=30` so jobs written by other processes are seen;
  - deterministic jitter (0–5 min hourly, 0–59 min daily, none when `strict_schedule`) pinned by
    hashing the job id (`pin_random_cron_fields`);
  - wall-clock DST handling (`_next_wall_clock_ts`);
  - `croniter` for expressions.
- **Locking.** A cross-process advisory lock `~/.kiro/crew/.crons.lock` (`kc/cron_service/store.py`
  `cron_store_lock`) lets the CLI and the gateway share the store. In-flight markers
  `cron-running/<job>.<token>.json` (`kc/cron_inflight.py`) stop a job that crashed the gateway from
  re-firing on every boot.
- **Storage.** `~/.kiro/crew/crons.json` `{"version","jobs":[…]}` (atomic, fsync; unreadable stores
  are quarantined). History in `cron-history/<job>.jsonl` plus `_index.jsonl`. Folders in
  `cron_folders.json`.
- **Surfaces.**
  - UI: `web/pages/SchedulePage.tsx`, `web/components/JobForm.tsx`.
  - HTTP: `/api/crons*` (CRUD, run, cancel, history, secrets).
  - MCP: `cron_add`, `cron_list`, `cron_update`, `cron_pause`, `cron_resume`, `cron_remove`,
    `cron_trigger`, `cron_secret_request` (`kc/mcp_cron_tool_list.py`).
  - CLI: `kirocrew cron …`.
- **Tests.** `test/test_cron_dst_next_run.py` (parametrised DST cases; meaningful),
  `test/test_cron_jitter.py`, `test/test_cron_refactor_contract.py`.
- **Recommendation: extend CMDeck's existing scheduled tasks.** CMDeck exposes
  `schedule_task`/`list_scheduled_tasks`/`run_scheduled_task_now` and
  `apps/server/src/mcp/toolkits/orchestrator/`. Whether that is upstream T3 or a CMDeck addition is
  for the CMDeck agent to verify; a new scheduler is not needed. Add the Kiro behaviours it lacks:
  - hash-pinned jitter with a strict override;
  - DST-correct wall-clock times with per-job timezone and skip dates;
  - consecutive-failure auto-pause or backoff;
  - crash-loop in-flight markers;
  - `managed_by` idempotent installs;
  - fresh vs persistent thread per run;
  - per-job run history.

### AUT-02 Deterministic scheduled scripts: Implemented+tested

- **Script jobs.** `script = "<data home>/crons/file.py:func"`. The path is confined to `crons/`
  (`kc/cron_script_paths.py` `resolve_script_path`). It runs in a sandboxed child process
  (`kc/cron_script.py` `run_script_sandboxed`, `wrap_argv`; strict mode seals `crons/` read-only
  when secrets are granted). Default timeout 30 s.
- **Control protocol.** `ScriptContext` with `SkipError` (quiet), `DoneError` (remove the job) and
  `ReportError` (deliver a message) (`kc/cron_script_context.py`). The status is read only from a
  stdout line carrying a **per-run random tag** (`_new_envelope_tag`, `_envelope_line`), so a
  script cannot fake `Done`. `ctx.call_tool()` and `ctx.notify()` are available.
- **Command jobs.** `/bin/sh` only (`run_command_sandboxed`). Vetted at save time and at fire time
  by a shell deny scan (`kc/mcp_cron_shell_scan.py`, `kc/mcp_cron_vet.py`). Default timeout 300 s.
- **Secret grants** (`kc/cron_script_grants.py`). The agent requests with `cron_secret_request`; the
  owner approves. The grant is **pinned to a digest of the script bytes, message and delivery
  target**, so editing the script invalidates it. Grants are refused for shell commands by design.
  Values are scrubbed from output, and output is redacted (`kc/cron_script_redaction.py`).
- **Tests.** `test/test_cron_script_execution.py` (49 tests; spawns real subprocesses) and about 15
  other `test_cron_script*.py` files.
- **Risks.**
  - With no sandbox backend and an opt-in env var, `wrap_argv` returns the argv unchanged
    (`kc/cron_script.py` around line 436).
  - Shell vetting is a deny-list over shell text, which is fragile.
- **Recommendation: native (new).** A scheduled task kind `script` with no LLM. It runs in CMDeck's
  sandbox abstraction (CMD-09 Docker or INF-09) and uses a JSON-lines result protocol with a
  per-run nonce (`skip | done | report`). Secret grants are pinned to a script hash. Only on
  "report" (or failure) does it wake an agent thread. This is the cheap monitoring path brief §9.5
  asks for ("avoid mandatory inference for routine monitoring").

### AUT-03 Heartbeat monitoring: Implemented+tested (it is a task file, not health monitoring)

- **What it does.** `HeartbeatService` (`kc/heartbeat.py`) ticks every 60 s.
  - It reads `~/.kiro/crew/workspace/HEARTBEAT.md`, takes markdown checklist lines (optional
    `<!-- deliver:slack:<chan> -->` tag) and runs each as a turn for agent `kirocrew-heartbeat`
    on session `_hb`.
  - A reply containing `HEARTBEAT_KEEP` keeps the task in the file; otherwise it is removed.
  - Each task times out after 1800 s. An optional in-memory backoff ladder is off by default.
- **Housekeeping on the same loop.** FTS rebuild every 15 ticks, history and security-event-log
  pruning, memory backups, and idle-session consolidation (`_beat`).
- **Bot heartbeats** (AGT-02) are separate cron jobs.
- **Tests.** About 17 `test/test_heartbeat*.py` files (for example `test_heartbeat_atomic_merge.py`).
  Some look coverage-driven (`test_heartbeat_cov80.py`); not opened.
- **Recommendation: adapt as a scheduled-task preset.** "Agent checklist file processed every N
  minutes until the agent marks each item done" maps onto a scheduled task bound to a thread. Keep
  maintenance chores on the server's own internal schedule, never on an agent turn. Before
  porting, clarify what the brief means by "Heartbeat monitoring": this file queue, bot liveness,
  or server health (Open question 1).

### AUT-04 Monitor Loops: Implemented+tested; judge off by default

- **Behaviour** (`kc/autonudge.py`, `kc/autonudge_service/`, about 13k lines). A loop is bound to
  one chat. After a turn ends, a timer counts toward `next_due_ts`; if no user input arrives first,
  it injects the loop message into **the same session**, tagged `[auto-nudge cycle N]`.
  - The deadline persists across user turns, so a busy chat does not starve the loop.
  - Fields (`kc/autonudge_service/model.py` `NudgeLoop`): `idle_secs` (minimum 15), `max_cycles`,
    `max_runtime_secs`, `stop_sentinel_path`, `gate`, `judge`.
- **Storage.** `~/.kiro/crew/autonudge.json`, versioned and locked. Loops re-arm on restart.
- **Surfaces.** MCP `monitor_start` (default 300 s, `_MONITOR_DEFAULT_MAX_CYCLES=24`),
  `monitor_watch` (typed structured monitors), `monitor_update`, `monitor_stop`. Runtime ceiling 7
  days, maximum 30 (`kc/monitoring/limits.py`). HTTP `/api/autonudge*`.
- **Structured decision.** `kc/monitoring/decision.py` `decide_monitor` is pure rules with no IO:
  terminal, then budget, then per-key dedup, then coalescing window, then floor. Kiro's own spec
  marks several layers "partial" (`spec/monitor-architecture.md`, **(docs-only)**).
- **Wake judge** (`kc/autonudge_judge.py`, `kc/decisions/points/nudge_wake.py`). Model-based and
  **fails open toward firing**: errors or low confidence still fire the loop, and the judge can
  never declare a watch finished. It requires `decisions_consent.json`, so it is off by default
  and loops are plain timers. This overlaps TLS-07 (Jev wake decisions, other agent).
- **Tests.** `test/test_monitor_decision.py` (61, pure), `test/test_autonudge_bare_pr_number.py`.
- **Recommendation: native, on the shared scheduler.** A loop = a scheduled task targeting an
  existing thread with an idle-after-turn trigger, cycle and runtime budgets, and a deterministic
  `decide()` function (terminal, budget, dedup, coalesce). An optional judge may only
  **suppress-with-fallback-to-fire**. One arming path, not two.

### AUT-05 PR monitoring: Implemented+tested (polling via CLIs)

- **Mechanism.** `monitor_watch` probes shell out to the forge CLI:
  - `kc/monitoring/github_pull_request.py` (`gh api` plus batched GraphQL);
  - `gitlab_merge_request.py` (glab), `azure_devops_pull_request.py` (az),
    `bitbucket_pull_request.py`, `github_workflow_run.py`;
  - shared transport `kc/monitoring/provider_cli.py`;
  - `kc/github_runner.py` refuses `gh` binaries that are foreign-owned, world-writable or under
    agent-writable roots, and passes a minimal environment.
  - No PR webhooks.
- **Wake rules** (`spec/babysit-pr-watch.md`, **(docs-only)** beyond the probe code):
  - a new actionable fingerprint;
  - **one-shot "checks finished green"** outside draft;
  - comments from someone other than the author.
- **Default.** `monitoring.prefer_structured_arming` is off.
- **Tests.** `test/test_github_pull_request_monitor.py` (39), plus the readiness and batched-read
  test files.
- **Recommendation: extend CMDeck's existing PR watch** (`watch_pull_request`,
  `apps/server/src/mcp/toolkits/pullRequests/`, plus CI-log tools for CMD-15). Ideas to add:
  - spend no model turn while provider facts are unchanged (fingerprint dedup);
  - a green-checks one-shot wake;
  - a non-author comment wake;
  - batched multi-PR GraphQL;
  - the hardened `gh` launcher checks.

### AUT-06 Inbound webhooks: Implemented+tested; UI preview-gated

- **Endpoint.** `POST /api/hooks/agent` runs an agent turn under session prefix `hook:`
  (`kc/dashboard/hooks_webhook_intake.py`). Limits: 6 concurrent, 256 KiB body, timeout ≤ 3593 s.
- **Auth** (`kc/webhooks.py`):
  - up to 20 named bearer tokens, stored **as sha256 only** and compared with
    `hmac.compare_digest` (`~/.kiro/crew/webhooks/tokens.json`);
  - optional per-token HMAC-SHA256 over `"{ts}.{body}"` with `X-KiroCrew-Timestamp`/`X-KiroCrew-Signature`,
    a ±300 s window and an in-memory replay set of 4096 (`verify_signature`). The signing secret is
    stored in plaintext (acknowledged in the code);
  - a failure damper: 10 failures per 60 s per source blocks it for 300 s (in memory);
  - a governance allow-list per source (`kc/webhook_sources.py`).
- **Run history.** A ring of the last 50 runs in `webhook_runs.json`.
- **Contexts.** Registrations in `hooks.json` decay by age: fresh up to 1 h, stale up to 24 h with a
  banner, then dropped.
- **Surfaces.** `web/pages/WebhooksPage.tsx`; preview gating is **(docs-only)**.
- **Tests.** `test/test_webhooks_signing.py` (window boundaries, malformed headers; meaningful),
  `test/test_webhooks_auth_surface.py`, `test/test_webhooks_store.py`.
- **Risk.** An unsigned token grants a full tool-enabled agent turn.
- **Recommendation: native, small.** CMDeck has an MCP webhook transport
  (`apps/server/src/mcp/McpWebhookTransport.ts`), purpose unverified here. Add inbound triggers as
  an event source on the shared scheduler/event pipeline (§9.2). Requirements:
  - hash-only tokens with **mandatory** HMAC and timestamp;
  - a durable replay window;
  - each token bound to one target (thread or workflow) and one prompt template;
  - payload passed as fenced untrusted data;
  - run history including rejections.

  For remote use, it must be reachable through Cloudflare Tunnel/Access (CMD-04) with an Access
  bypass only for that path.

### AUT-07 Automatic quota recovery: Partial (user-armed, in memory)

- **Usage-limit continue.** `kc/limit_reset.py` `parse_limit_reset` parses the provider's reset
  sentence (up to 8 days ahead).
  - The user must press "Continue automatically after <time>"
    (`POST /api/chat/slots/{slot}/limit-continue`; `kc/dashboard/limit_continue.py`).
  - An in-memory timer fires at reset + 60 s and re-checks the wall clock every 60 s (survives
    sleep).
  - Before continuing it verifies under the slot lock that the chat **still ends on the same limit
    row with no turn since**.
  - A restart drops the wait; the row keeps `reset_at`, so the button returns.
  - Tests: `test/test_usage_limit_continue_at.py` (42), `test/test_usage_limit_reset_time.py` (14).
- **Model fallback.** `agent.fallback_model` walks a fallback chain on transient, capacity or
  throttle errors (`kc/llm_helpers.py` `advance_fallback_candidate`, `spec/model-fallback.md`).
  - Kiro's per-user rate limit never starts the walk, because all models share the allowance.
  - A sticky probe restores the primary model.
- **Backend failover.** `kc/acp_failover.py` swaps backend only at spawn time. `usage_limit` and
  `auth` are listed in `_NOT_YET_ACTIVE`. Tests: `test/test_acp_backend_failover.py`.
- **Cron.** No usage-limit handling in cron (searched `kc/cron_service/`,
  `kc/slack/gateway_runtime/cron_*.py`). Cron only classifies the error and backs off.
- **Recommendation: native, as part of one usage/quota/recovery system (brief §9.2) and INF-10.**
  - Make the wait **durable** (a scheduled one-shot task), which Kiro lacks.
  - Keep the "same limit row, no turn since" guard.
  - Make auto-arming a per-thread or per-automation setting.
  - Parse reset times per provider in the adapter (complexity at the adapter boundary).

## 5. Chat and session management (CHT)

Storage for all of these is described in §6.

### CHT-01 Session search: Implemented+tested

- **Three surfaces.**
  - Sidebar: `kc/dashboard/handlers/sessions_parts/history_reads.py` `api_sessions_search` →
    `GET /api/sessions/search`.
  - All chats: `message_search.py` `api_sessions_search_messages` (Bot, speaker, date and `title:`
    filters).
  - Per-chat: `kc/dashboard/chat_history_search.py` → `/api/chat/slots/{slot}/history/search`.
- **Index.** `kc/history_index.py` `SessionSearchIndex` at `sessions/.index/session_index.db`:
  - `session_fts` (FTS5 **trigram**) and `session_cjk` (unicode61);
  - `session_entry` (mtime/size/digest per session) and `session_text` (zlib).
  - Self-described as "a candidate filter … never a ranker".
- **Ranking.** In Python (`kc/history_search.py` `search_sessions`, `kc/history_search_rank.py`):
  BM25-style idf with saturating counts (`_BM25_K1=5.0`), title ×10, recency up to ×2.5, every term
  required. Only the newest 2000 sessions are scanned.
- **Per-chat cache.** A lazy FTS5 trigram DB per chat (`kc/chat_search_cache.py`).
- **Semantic session search.** Default off (`session.semantic_search=False`).
- **Tests.** `test/test_history_index.py` (40; meaningful), `test/test_dashboard_sessions_search.py`
  (6; thin), `web/components/globalChatSearch/GlobalChatSearchDialog.test.tsx`.
- **Recommendation: extend CMDeck's existing thread search.** CMDeck has `t3_thread_search` and
  `apps/server/src/orchestration-v2/ThreadFind.ts`; scope is for the CMDeck agent to confirm. Add
  FTS5 trigram over message text as a candidate filter, title boost and recency in ranking, and a
  message-level hit list with jump-to-message. Skip CJK segmentation and vectors at first.

### CHT-02 Session forking: Implemented+tested; tail fork off; merge-back API-only

- **Fork.** `kc/dashboard/chat_fork.py` `api_chat_slot_fork` → `POST /api/chat/slots/{slot}/fork`.
  - Body: `at_message_index` or `at_message_id`, `prompt`, `direction: head|tail`, `memory_mode`.
  - Rows are **re-appended** to a new transcript with non-user text redacted and provenance kept.
    `forked_from`/`forked_from_created_at` are set, and project, folder and pin are inherited.
  - The native agent session is **not** copied. The first child turn replays history as text
    (`kc/dashboard/chat_turn/prompt_assembly.py` `_session_replay_history`).
  - `/fork <prompt>` works in the composer. Tail fork is gated by `dashboard.tail_fork_enabled=False`.
- **Rewind** (`kc/dashboard/chat_rewind.py`). Edit and resend: cut the history and re-run. On the
  Claude backend it forks the native session.
- **Merge-back** (`kc/dashboard/chat_merge_back.py`). A background model drafts a summary of the
  fork, and the edited summary is posted into the parent as a note. No web client exists (grep of
  `web/` for `merge-back` found nothing).
- **MCP.** `session_fork`.
- **Tests.** `test/test_dashboard_chat_fork_tail.py`, `test/test_chat_merge_back.py`,
  `test/test_dashboard_chat_rewind.py`, and about 12 `test_chat_fork_*` files.
- **Recommendation: existing in CMDeck — improve.** CMDeck has thread fork (`ThreadFork` in
  `apps/server/src/orchestration-v2/Orchestrator.ts` and the provider adapters). Candidate
  additions: fork-at-message, fork keeps the memory mode, and "merge back as note" (KCX-05).

### CHT-03 Cross-session control: Implemented+tested (very large)

- **Structure.** `kc/dashboard/session_control.py` is a facade over 16 modules. Routes:
  `/api/session-control/{create,fork,stop,send,broadcast,status,read,summary,queue,run-queued,handoff,adopt,release,…}`.
- **MCP tools** (`kc/mcp_dashboard_session_tools.py`): `session_create`, `session_send`,
  `session_read_message`, `session_handoff`, `session_queue`, `session_run_queued`,
  `session_broadcast`, and others.
- **One deny-by-default gate.** `authorize_target`
  (`kc/dashboard/session_control_parts/target_authorization.py`). It refuses: self; cron and
  workflow targets; incognito and temporary targets; app-scoped targets; channel-mirrored sessions;
  other workspaces; ambiguous titles. Every refusal is audited.
- **Managers.** Recorded in `crew-log/session_managers.json` (`kc/dashboard/session_managers.py`).
  Creator ownership is `_created_by`.
- **Tests.** `test/test_session_handoff.py` (33; meaningful), `test/test_session_control_boundaries.py`,
  `test/test_mcp_dashboard_session_queue.py`.
- **Recommendation: existing in CMDeck — improve.** CMDeck already has `t3_thread_send`,
  `t3_thread_read`, `t3_thread_interrupt`, `t3_thread_launch`, `t3_thread_transfer` and
  `t3_thread_wait` as MCP tools. Port the **single authorisation gate** with Kiro's refusal list
  (especially: never target incognito or temporary threads, and audit refusals), plus
  creator/manager ownership if conductor mode is built.

### CHT-04 Split-view conversations: Implemented+tested, browser-only

- **Layout model.** A recursive tree, `GridSplit{dir,sizes[]}` / `GridLeaf{placeholder|session|terminal}`
  (`web/hooks/useSessionGrid.ts`). Minimum pane size `MIN_FRAC=0.12`; no other pane cap found.
- **Shortcut.** ⌘D / Ctrl+D (`web/hooks/splitChord.ts`).
- **Persistence.** `localStorage['mc-split-layouts']` keyed by the anchor slot
  (`web/hooks/splitLayoutStore.ts`). Inactive panes can be dimmed (`useDimInactivePanes.ts`).
- **Tests.** `web/test/splitLayoutStore.test.ts`, `web/test/splitChord.test.ts`,
  `web/test/UseSessionGridCoverage.test.tsx`.
- **Recommendation: native web-only feature.** No split view was found in CMDeck by keyword search;
  the CMDeck agent should confirm. Use a two-level tree (rows/cols) with per-browser persistence.
  Desktop gets it free. Mobile/PWA should fall back to a single pane (AGENTS.md "hit every
  surface": state "not supported on phone widths"). Watch render cost: each pane is a full
  transcript (AGENTS.md performance).

### CHT-05 Editable queued messages: Implemented+tested

- **Server queue.** In memory (`kc/dashboard/slot_queue_repository.py`), persisted as
  `queued_prompts` on the transcript metadata line (`kc/history_schema.py`) with a stale-write
  signature.
- **Routes.**
  - `PATCH /api/chat/slots/{slot}/queue/{id}`: edit.
  - `DELETE …/queue/{id}`: cancel.
  - `PUT …/queue/order`: reorder.
  - `POST …/queue/{id}/editing`: an **edit hold**, so the queue does not drain the old text while
    the editor is open (`kc/dashboard/queue_edit_hold.py`).
- **Steer retract.** `POST …/steers/{mid}/retract` works on the Kiro CLI backend only
  (`kc/agent_sdk/backends_turns.py` `ACP_BACKENDS_STEER_RETRACT`).
- **UI.** `web/components/QueueStack.tsx`, `web/hooks/useQueuedMessageActions.ts`.
- **Tests.** `test/test_queue_edit.py` (id and order preserved; meaningful), `test/test_queue_edit_hold.py`,
  `test/test_queue_reorder.py`, `web/test/QueueStack.test.tsx`.
- **Recommendation: existing in CMDeck — improve.** CMDeck has queued-message handling in
  `apps/server/src/orchestration-v2/` and `t3_queue`; whether edit and reorder exist is for the
  CMDeck agent. Port edit, reorder and the edit-hold race guard as orchestration commands in
  `packages/contracts` so mobile follows.

### CHT-06 Message quoting and pinning: Implemented+tested

- **Quote.** Built in the browser (`web/chat-core/composer/messageQuote.ts` `quoteFromMessage`,
  `QUOTE_TEXT_MAX=1500`). Sent as a markdown blockquote (what the agent sees) **and** `meta.quote`
  (what the UI draws), validated server-side (`kc/dashboard/chat_delivery.py` `QUOTE_TEXT_MAX_LEN=2048`).
  Card: `web/pages/chat/QuoteCard.tsx`.
- **Pins.**
  - `kc/dashboard/chat_pins.py`: `GET/POST /api/chat/pins`, `DELETE /api/chat/pins/{id}`.
  - Record `{id, slot_key, mid, message_ts, role, preview, pinned_at, origin_app}`, at most 50 per
    slot, in one global `~/.kiro/crew/chat_pins.json`.
  - UI: `web/pages/chat/PinnedMessagesPanel.tsx`.
  - A pin of your own message can be put back into the composer.
- **Tests.** `test/test_dashboard_chat_pins.py` (44), `test/test_queue_quote_meta.py`,
  `web/test/messageQuote.test.ts`.
- **Recommendation: native.** No pin or quote feature was found in CMDeck, apart from response
  citations in `apps/web/src/components/chat/AssistantCitationChip.tsx` (unverified). Store pins as
  orchestration events on the thread (so they sync to mobile and remote clients), not in a global
  file. Quote = text for the agent plus structured meta for the UI from one record.

### CHT-07 Context breakdown: Implemented (web tests only)

- **Measurement.** `kc/context_blocks.py` classifies the final assembled prompt by the bracket
  markers Kiro's builder writes (`[CRITICAL RULES`, `[SESSION CONTEXT`, …), in **characters, not
  tokens**. Anything unmatched is `unclassified`.
- **Storage.** Per-turn sums come from the crew-log usage projection
  (`kc/dashboard/handlers/usage_context.py` `context_trace`). Full prompt text is in memory only (8
  turns per session, `kc/prompt_trace.py`).
- **KAS extra.** On KAS, engine-measured categories are added.
- **UI.** `web/pages/ContextBreakdownPanel.tsx`, plus "Steering in this chat" with per-chat
  switch-offs.
- **Tests.** `web/test/ContextBreakdownPanel.test.tsx`. No Python test named for `context_blocks`
  or `prompt_trace` was found.
- **Assessment.** Kiro can do this because it **assembles the prompt itself**. CMDeck passes turns
  to provider CLIs that assemble their own context.
- **Recommendation: harness-dependent; adapt per provider.** Show what CMDeck itself injects
  (memory blocks, skills, attachments) by size, plus whatever token or context usage each adapter
  reports. Mark the rest "assembled by <provider>, not visible". Don't fake a breakdown CMDeck
  cannot measure (brief §15).

### CHT-08 Quiet-turn indicator: Implemented+tested (no dedicated badge)

- **What a quiet turn is.** A turn in which the agent decides there is nothing to say. It calls MCP
  `nothing_to_do` (with an optional note) and ends with `QUIET_END_TOKEN="(quiet)"`
  (`kc/session_directive.py`).
  - The token is stripped from the stream (`kc/acp/end_token.py` `drop_end_token`).
  - The host refuses `nothing_to_do` on a turn a person opened.
- **Display.** The applied tool row is stamped `meta.ends_turn`, and `isQuietEndRow`
  (`web/store/chat/selectors.ts`; mirrored by `kc/dashboard/state_parts/transcript_rows.py`
  `is_quiet_end_row`) makes the turn count as **finished, not interrupted**. The turn folds into
  its working steps, and empty or zero-width replies draw no bubble (`web/utils/invisibleText.ts`).
  No "quiet" label string was found.
- **Tests.** `test/test_nothing_to_do_directive.py` (47), `test/test_acp_end_token.py`,
  `web/test/emptyReplyBubbles.test.tsx`.
- **Recommendation: native, small.** An MCP tool `nothing_to_report(note?)` available only on
  automated turns (schedule, loop, webhook). The UI shows a compact "Checked, nothing to report"
  row and suppresses unread/notification for that turn. This is high value for automations and
  pairs with AUT-02/04.

### CHT-09 Session notes: Implemented ("note into a chat", not a notes document)

- **What it is.** `POST /api/chat/slots/{slot}/note` (`kc/dashboard/chat_api/slot_note.py`
  `api_chat_slot_note`). A background actor (cron, app, another agent) adds a note to a chat
  **without starting a turn**, as two writes:
  1. a visible row (`role="inject"`, `cls="reconcile-note"`);
  2. one-shot `_pending_context` prepended to the user's next message, expiring after 24 h by
     default.
     While a turn is running, notes wait in `deferred_notes` on the metadata line.
- **Shared code.** `deliver_note` is shared with merge-back. MCP `session_set_note` → `write_slot_note`.
  `drop_session_notes_out_of_reach` (`kc/dashboard/chat_turn/turn_context.py`) is the only
  `session_notes` identifier.
- **Not this feature.** `kc/member_notes.py` is a Bot's `briefing.md`. Kiro's Notes **app**
  (PRD-03) is owned by the other Kiro agent.
- **UI.** Rendering only (`web/lib/noteContract.ts`). No user-facing compose button was found.
- **Tests.** Covered via the `test/test_chat_merge_back*` files. No dedicated `slot_note` test was
  opened.
- **Ambiguity.** The brief's "Session notes" may mean a user scratchpad per session instead
  (Open question 2).
- **Recommendation: native, small.** A `thread.note.append` command (visible row plus one-shot
  context for the next turn, never starts a turn) reachable by MCP and scheduled tasks. If the user
  meant a scratchpad, it is a thread-scoped markdown field. Decide before building.

## 6. Data stores for the importer (CMD-20 / INF-12)

**Data home:** `~/.kiro/crew` (Windows `%USERPROFILE%\.kiro\crew`), overridable by `KIROCREW_HOME`
(`kc/config/paths.py`). The legacy location was `~/.kirocrew`. Bot spec copies live under
`~/.kiro/mates/`. Agent configs are under `~/.kiro/agents/` (Kiro CLI layout). kiro-cli keeps its
own replay logs in `<kiro home>/sessions/cli/`.

| Data                             | Location and format                                                                                                                                                                                                                                | Schema / owner                                                                                                                                                                                                                                                                                    | Import?                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session transcripts              | `sessions/<safe_key>.jsonl` (`_safe_key`: chars outside `[\w\-.]` → `_`); rotated segments `sessions/archive/<stem>__<stamp>.jsonl` (rotation at 10 MB); attachments `sessions/<stem>.attachments/`; reply threads `sessions/.threads/<stem>.json` | Line 1 `{"_type":"metadata",…}` with `title, agent, model, mode, workspace, memory_mode, project, pinned, forked_from, queued_prompts, deferred_notes, …` (`kc/history_schema.py` `SLOT_OWNED_META_KEYS`; `kc/history_append.py`); rows `{role, content, cls?, ts, tools?, meta{mid, quote?, …}}` | **Optional, read-only archive.** Import as read-only "imported" threads (no provider session to resume). Skip `memory_mode ∈ {incognito, temporary}` and anything in `archive/` unless asked. Kiro's own importer refuses transcripts on principle (`spec/onboarding-import.md` §No session import), so make this opt-in. |
| Search indexes                   | `sessions/.index/session_index.db`, `session_vectors.db`, `sessions/.search-cache/*.db`                                                                                                                                                            | Caches rebuilt from JSONL                                                                                                                                                                                                                                                                         | No                                                                                                                                                                                                                                                                                                                        |
| Session map                      | `session_map.json` (`kc/session_map.py`)                                                                                                                                                                                                           | Host-local; excluded from Kiro export                                                                                                                                                                                                                                                             | No                                                                                                                                                                                                                                                                                                                        |
| Message pins                     | `chat_pins.json`                                                                                                                                                                                                                                   | `{id, slot_key, mid, …}`                                                                                                                                                                                                                                                                          | Yes, if transcripts are imported                                                                                                                                                                                                                                                                                          |
| Memory V1                        | `workspace/memory/preferences.md`, `projects.md`, `history/YYYY-MM-DD.md`; `memory.db` (`semantic_memory`, `episodic_memories`, `memory_revisions`, `memory_record_meta`); `memory_index.db` (FTS cache)                                           | `kc/vector_memory_lifecycle.py` `_SCHEMA_V1`, `kc/memory_record_metadata.py`                                                                                                                                                                                                                      | **Yes.** Facts and preferences become `user`/`global` memory items with provenance `imported:kirocrew`. Daily history becomes optional `episode`s. Drop embeddings (model-specific) and re-embed if CMDeck embeddings are enabled.                                                                                        |
| Lessons                          | `lessons.jsonl` (`kc/learn.py` `Lesson`: `ts, rule, category, negative, repo_scope, applies, written_by`)                                                                                                                                          | —                                                                                                                                                                                                                                                                                                 | **Yes**, as **pending proposals** the user accepts (they may be agent-inferred; §3 poisoning). Map `repo_scope` to a CMDeck project only when the user picks one.                                                                                                                                                         |
| Bot private memory (V2)          | `memory_stores/<store>/memory.db`                                                                                                                                                                                                                  | `kc/memory_schema.py` `memory_items`, `memory_history`, `memory_fts`, `member_database`                                                                                                                                                                                                           | Yes, with bots: scope `bot:<id>`; check `member_database` identity.                                                                                                                                                                                                                                                       |
| Bots                             | `config.json` `agents.<name>`; `members/<slug>/briefing.md`, `activity.jsonl`; `member-records/{member-rules,member-goals,member-bindings}/<slug>.json`; `crew-teams/teams.json`; `~/.kiro/mates/agents/<id>.json`                                 | `kc/member_records.py`, `kc/mate_config.py`                                                                                                                                                                                                                                                       | Yes: name, prompt/rules, notes, model preference become a CMDeck agent/bot profile. Skip harness pins and Kiro-specific agent specs.                                                                                                                                                                                      |
| Schedules                        | `crons.json` `{"version","jobs":[…]}`; `cron_folders.json`; history `cron-history/*.jsonl`; scripts `crons/*.py`                                                                                                                                   | `kc/cron_service/model.py` `CronJob`, `kc/cron_service/store.py`                                                                                                                                                                                                                                  | **Yes, disabled on import** (Kiro's own importer does the same). Map `every`/`at`/`cron` and timezone. Script and command jobs are imported **disabled with a review flag** (they execute code). Secret grants are never imported.                                                                                        |
| Monitor loops                    | `autonudge.json`                                                                                                                                                                                                                                   | `kc/autonudge_service/store.py`                                                                                                                                                                                                                                                                   | Optional; they are bound to transcripts, so low value.                                                                                                                                                                                                                                                                    |
| Heartbeat tasks                  | `workspace/HEARTBEAT.md`                                                                                                                                                                                                                           | Markdown checklist                                                                                                                                                                                                                                                                                | Optional, as a disabled preset task.                                                                                                                                                                                                                                                                                      |
| Skills                           | `skills/` (including `skills/auto/.pending`, `.archive`)                                                                                                                                                                                           | `SKILL.md` folders                                                                                                                                                                                                                                                                                | Yes, approved skills only, via TLS-03 rules. Skip `.pending`.                                                                                                                                                                                                                                                             |
| Knowledge                        | `workspace/knowledge/knowledge.db`                                                                                                                                                                                                                 | `kc/knowledge/store_parts/schema_migrations.py`                                                                                                                                                                                                                                                   | Import **source definitions** (paths) and re-ingest. Don't copy chunks or embeddings.                                                                                                                                                                                                                                     |
| Workflows                        | `workflows/runs/*.json`, library JSON                                                                                                                                                                                                              | `kc/workflows/store.py`, `library.py`                                                                                                                                                                                                                                                             | No: the definitions are Python code (AGT-05 risk). At most list them for manual porting.                                                                                                                                                                                                                                  |
| Task Runner                      | `runs.json`, `tasks/tasks.db`                                                                                                                                                                                                                      | `kc/taskq/migrate.py`                                                                                                                                                                                                                                                                             | No (runtime state).                                                                                                                                                                                                                                                                                                       |
| Work / session ledgers, crew log | `work-ledger/…`, `crew-log/sessions/<unit>/log.jsonl`, `crew-log/session_managers.json`                                                                                                                                                            | `kc/work_ledger_store.py`, `kc/crew_log/`                                                                                                                                                                                                                                                         | No (runtime state).                                                                                                                                                                                                                                                                                                       |
| Agent Channels                   | `channels/<id>.json` (last 200 msgs)                                                                                                                                                                                                               | `kc/channel.py`                                                                                                                                                                                                                                                                                   | Optional, as a read-only archive.                                                                                                                                                                                                                                                                                         |
| Webhooks                         | `webhooks/tokens.json` (hashes), `webhook_runs.json`, `hooks.json`                                                                                                                                                                                 | `kc/webhooks.py`                                                                                                                                                                                                                                                                                  | No. Tokens are hashes and can't be re-used; ask the user to re-create them.                                                                                                                                                                                                                                               |
| Research Lab                     | `apps/auto-research/campaigns.db`, `workspace/research/<id>/FINDINGS.md`                                                                                                                                                                           | `…/campaign/storage.py`                                                                                                                                                                                                                                                                           | Optional: findings markdown as artifacts.                                                                                                                                                                                                                                                                                 |
| Settings                         | `config.json`, `config.local.json`, `ui-prefs.json`, `notification_settings.json`, `mcp.json`                                                                                                                                                      | `kc/config/`                                                                                                                                                                                                                                                                                      | Partial: MCP server definitions (sanitised, disabled until reviewed), timezone. No secrets (`.env`, `.local_secret`, the vault) and no telemetry salt/install id.                                                                                                                                                         |

**Best import source.** Kiro's own **portability export zip** (`kc/portability_export.py`,
`kc/portability_archive.py`; dashboard `/settings/imports`, `GET /api/portability/export`) is
better than reading a live home. It already:

- takes consistent SQLite backups from checkpointed DBs;
- refuses links;
- excludes secrets (`EXPORT_EXCLUDE`: `.env`, `.local_secret`, `sel_hmac.key`, `telemetry_salt`,
  `session_map.json`);
- groups files by component (`kc/snapshot_components.py` `COMPONENTS`: memory, crons, config,
  skills, crew-teams, workspace, members, artifacts, …);
- has a manifest, including a memory-only mode (`MEMORY_EXPORT_MANIFEST_VERSION = 1001`).

Recommend that the CMDeck importer accept (a) a Kiro export zip and (b) a live data home read
read-only, behind the same adapter. It should copy SQLite files to a temp location before opening
(Kiro writes with WAL). Treat all content as untrusted data.

## 7. Telemetry and phone-home (exclusion input, EXC)

Kiro Crew's **public build phones home by default**:

1. **Anonymous daily beacon, default-on** (`kc/beacon.py`; `kc/config/sections_telemetry.py`
   `beacon_enabled=True`, `_DEFAULT_BEACON_ENDPOINT="https://d175o3ylxqum0e.cloudfront.net"`).
   - Five fields: a random install id `id`, `v`, `py`, `dist`, `first_seen`.
   - Suppressed in CI and for a non-default `KIROCREW_HOME`.
   - Opt out with `DO_NOT_TRACK`, `KIROCREW_TELEMETRY_DISABLED`, or the setting.
2. **Product metrics export to Kiro, default-on whenever local recording is on**
   (`kc/metrics/kiro_export.py` `ENDPOINT="https://telemetry.us-east-1.kiro.dev/v1/metrics"`).
   - Local `telemetry.enabled` defaults to `True`.
   - The docstring says config cannot remove or repoint this destination; only turning recording
     off stops it.
3. **Default-on downloads.**
   - The 610 MB embedding model from CloudFront (`kc/embeddings_settings.py`).
   - Feature videos from `https://d3j0sthz5doyui.cloudfront.net/feature-videos`
     (`kc/feature_videos_manifest.py`).
   - Decision local models from `https://dostcaqwrph3m.cloudfront.net` (`kc/decisions/local_models.py`).
4. **Update checks** against `https://updates.crew.kiro.dev` / `download.crew.kiro.dev`
   (`kc/platform/update_layout.py`).
5. **Background LLM turns** (consolidation, skill detection, knowledge extraction, judges). These go
   to the user's configured model provider through the harness. They are not telemetry, but they
   are extra outbound inference that CMDeck must make opt-in.

The web RUM shim is a no-op in the public build (`web/rum.ts`: "telemetry disabled"). None of 1–4
may be ported (CMD-01, EXC). Background inference must be opt-in, preferably on local models.

## 8. KCX: unselected Kiro features met during this audit

| ID     | Feature                                                                                            | Evidence                                                                             | Note                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KCX-01 | Crew board (kanban view of the work ledger)                                                        | `web/pages/CrewBoardPage.tsx`, `/api/crew-board`                                     | **Excluded** (kanban/board). Use a list in the conductor side panel instead.                                                                                        |
| KCX-02 | Chat-tag board columns                                                                             | `kc/board_tag_grammar.py`, `chat_tag_column_*` tools                                 | **Excluded** (board).                                                                                                                                               |
| KCX-03 | Beacon plus Kiro OTLP metrics export                                                               | `kc/beacon.py`, `kc/metrics/kiro_export.py`                                          | **Excluded** (telemetry), §7.                                                                                                                                       |
| KCX-04 | Default-on CDN downloads (embedding model, feature videos, decision models) and update checks      | §7 items 3–4                                                                         | **Excluded** (phone-home); any download must be explicit.                                                                                                           |
| KCX-05 | Merge a fork back (summary note into the parent)                                                   | `kc/dashboard/chat_merge_back.py`                                                    | Small, useful complement to CHT-02. Needs approval.                                                                                                                 |
| KCX-06 | Rewind / Edit & Resend                                                                             | `kc/dashboard/chat_rewind.py`                                                        | Likely overlaps T3 edit/revert; CMDeck agent to check.                                                                                                              |
| KCX-07 | Broadcast one message to many sessions                                                             | `/api/session-control/broadcast`, feature map "Broadcast message"                    | Overlaps CHT-03; low priority.                                                                                                                                      |
| KCX-08 | Side chat (read-only scratch sub-conversation)                                                     | `spec/side.md`, feature map "Side chat"                                              | Not selected; note only.                                                                                                                                            |
| KCX-09 | Prompt stash (Ctrl/Cmd+S)                                                                          | feature map "Prompt stash"; `localStorage mc-prompt-stash:*`                         | Not selected; trivial client feature.                                                                                                                               |
| KCX-10 | Promote incognito → persistent                                                                     | `kc/dashboard/chat_fork.py` `api_chat_slot_promote`                                  | Required reverse state for MEM-06; fold into MEM-06.                                                                                                                |
| KCX-11 | Onboarding importer from other agents (Claude Code, Codex, Gemini, Hermes, OpenClaw, Amazon Quick) | `kc/onboarding_import.py`, `kc/onboarding_sources/*.py`, `spec/onboarding-import.md` | Relevant to CMD-21. Kiro imports instructions as lessons, MCP configs, skills and schedules (disabled), and **deliberately no transcripts**. Good reference design. |
| KCX-12 | Portability export/import zip                                                                      | `kc/portability_*.py`, `/settings/imports`                                           | Best input format for CMD-20 (§6).                                                                                                                                  |
| KCX-13 | Memory provider abstraction (replace/augment/migrate/benchmark)                                    | `kc/memory_provider/`, `handlers/memory_provider*.py`                                | Not needed in CMDeck v1; avoid.                                                                                                                                     |
| KCX-14 | Bot goals, key results and check-in reports                                                        | `kc/member_goals.py`, feature map "Bot goals"                                        | Extends AGT-02. Needs approval.                                                                                                                                     |
| KCX-15 | Session summary side panel                                                                         | `spec/session-summary.md`, feature map "Session summary"                             | Background-model summary; check overlap with T3.                                                                                                                    |
| KCX-16 | Self-arming nudges / goal loops                                                                    | `kc/autonudge_selfarm.py`, `skills/goal-loop`, `skills/self-nudge-loop`              | Part of AUT-04; fold in.                                                                                                                                            |
| KCX-17 | Repeated tool-failure card → draft lesson                                                          | `web/pages/overview/MemoryFailuresCard.tsx`, `/api/sel/recurring-failures`           | A safe self-learning input (user drafts the lesson). Consider under MEM-03.                                                                                         |

## 9. Ledger entries (for the lead to merge into `RESEARCH_LEDGER.md`)

- 2026-11-26 [kiro-1] completed — AGT-01..10, MEM-01..10, AUT-01..07 and CHT-01..09 audited at
  `kirocrew@b75544f0db`; data-store map and telemetry findings in this note (medium-high).
- 2026-11-26 [kiro-1] decision (proposed) — Task Runner, Conductor and Research Lab become presets
  on one workflow engine. AGT-05 must not execute model-authored code; use a declarative DAG
  (high).
- 2026-11-26 [kiro-1] decision (proposed) — one `memory_items`-style SQLite table with a `scope`
  column, a revisions table and FTS5; embeddings opt-in via local providers; poisoning gates on by
  default (Kiro ships them off) (high).
- 2026-11-26 [kiro-1] conflict — Kiro "Heartbeat" is a HEARTBEAT.md task queue plus maintenance,
  not health monitoring; AUT-03 meaning needs a decision (high).
- 2026-11-26 [kiro-1] conflict — Kiro "Session notes" is "note injected into a chat without a
  turn", not a notes document; CHT-09 meaning needs a decision (high).
- 2026-11-26 [kiro-1] question — CMDeck already has scheduled tasks, PR watch, thread fork, thread
  search, queued messages and an MCP webhook transport (keyword evidence only); the CMDeck agent
  should confirm which AUT/CHT items are "Existing — improve".
- 2026-11-26 [kiro-1] exclusion — Kiro beacon (CloudFront) and Kiro OTLP metrics export are
  default-on; CDN model and video downloads and update checks are default-on (EXC, high).

## 10. Open questions

1. **AUT-03 "Heartbeat monitoring"**: Kiro's file-driven agent task queue, bot heartbeats (AGT-02
   cron jobs), or server and agent health checks? Recommendation: a scheduled-task preset plus
   CMDeck's existing health/crash recovery (INF-04); no HEARTBEAT.md file.
2. **CHT-09 "Session notes"**: Kiro's meaning (out-of-band note into a thread, one-shot context) or
   a per-thread user scratchpad? Recommendation: build Kiro's meaning (it serves automations); a
   scratchpad is a separate, trivial request.
3. **CHT-07** can only be partial because providers assemble their own context. Is a partial,
   honest breakdown acceptable?
4. **Background inference** (consolidation, skill detection, judges): must it run only on local
   models, or may it use the thread's provider with consent? Kiro uses the harness by default.
5. **Transcript import**: Kiro itself refuses transcript import as misleading context. Should CMDeck
   import Kiro sessions as read-only archives (useful for search) or skip them?
6. **AGT-09 Agent Channels vs AGT-03 Conductor**: both are multi-agent coordination; Kiro ships
   channels hidden. Build both, or conductor only?
7. Was the brief's "Selective workflow retry" meant literally (retry one failed node)? Kiro only
   has rerun-from-index with fingerprinted replay. The proposed position-path cache gives true
   selective retry.

## 11. Not checked

- Frontend logic beyond file names, header comments and a few hooks.
- Pipeline and security conductor scripts (`spec/pipeline-conductor.md` is **(docs-only)** here).
- Bodies of the decay, heartbeat and most vector tests.
- Whether raw tool output enters the memory consolidation span.
- The exact file holding structured monitors.
- The source-level preview flag for the Webhooks page.
- CMDeck equivalents were found by keyword only; the CMDeck agent owns that verification.
