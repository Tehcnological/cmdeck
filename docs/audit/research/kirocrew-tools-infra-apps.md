# Kiro Crew audit: tools, infrastructure, developer apps, AWS, productivity, messaging

Scope: TLS-01..08, INF-01..12, DEV-01..06, AWS-01..05, PRD-01..03, MSG-01..03, and the
Bedrock/AWS functionality found on the way (`BRK-*`). AGT/MEM/AUT/CHT and the architecture
overview belong to the other Kiro agent.

- Repo: `kirodotdev/KiroCrew` @ `b75544f0db` (2026-11-26, prerelease `v0.14.0-rc.5`; `pyproject.toml`
  says `0.15.0`). Apache-2.0, `NOTICE` (Amazon copyright), `THIRD-PARTY-NOTICES` (12.6k lines).
- Read-only static review. Nothing was installed or run. Citations use
  `kirocrew@b75544f0db:<path>` + symbol; paths are relative to `src/kiro_crew/` unless they
  start with `docs/`, `test/` or `pyproject.toml`/`setup.cfg`.
- **(docs-only)** marks a claim taken from Kiro's own docs without a source read. Kiro's docs
  (`docs/architecture/security-deep-dive.md`, `docs/system-specs/modules/*.md`) are unusually
  candid. I spot-checked the load-bearing claims against source and say where I did not.

## Orientation (short)

- Python 3.12+ `aiohttp` gateway (`kirocrew gateway`) with a React dashboard (`website/`). The
  default agent is **`kiro-cli`** over ACP. Other ACP harnesses are listed under INF-11.
- Size: about **2.48M lines of non-test Python** under `src/` and **8,557 `test_*.py` files**
  in `test/`, plus per-app `tests/` folders. Most subsystems are split into "facade + owner
  modules" with a `_facade_mirror` that copies monkeypatches across modules
  (`_facade_mirror.py`, `_facade_compose.py`). The pattern exists to keep test patches
  working and accounts for much of the size.
- Runtime deps (`setup.cfg [options] install_requires`): aiohttp, httpx[http2], slack-sdk,
  websockets, cryptography, numpy, jsonschema, opentelemetry-api/sdk/exporter-otlp-proto-http,
  python-docx, openpyxl, pdfplumber, `uv`, and others. Extras: `teams` (PyJWT), `bedrock`
  (boto3), `voice-aws` (boto3, amazon-transcribe), `whatsapp`, `feishu`.
- Built-in "apps" live in `apps/builtins/<name>/` with an `app.json` manifest (permissions:
  API allowlist, storage, network, cron, MCP tools). Every app audited here has
  `"defaultEnabled": false`.

---

## TLS: tools and customization

### TLS-01 Live browser with human takeover: Implemented+tested

- **Driver.** The gateway runs [browser-use/browser-harness](https://github.com/browser-use/browser-harness)
  `0.1.13` as a daemon, from a sha256-locked venv at `<home>/browser-harness`
  (`browser_harness/__init__.py:HARNESS_VERSION`, `browser_harness/install.py`,
  `browser_harness/requirements.lock`). The daemon talks CDP to a loopback **CDP relay** that
  the gateway owns (`browser_harness/relay.py`). Agents call an allowlist of Harness helpers
  over IPC (`browser_harness/supervisor.py`). There is no Playwright in this path. Playwright
  appears only in Design Critique's capture browser (DEV-05).
- **Which browser.** The `auto` order is **the user's own Chrome (with their logins)**, then
  Edge, then a Kiro-downloaded Chromium, which runs headless
  (`browser_harness/discover.py:BrowserKind`, `CHOICES`; Chromium download in
  `browser_harness/chromium.py`).
- **Live stream.** CDP `Page.startScreencast` JPEG on a relay-owned session. Frames are paced
  by client acks, with an adaptive fps/quality ladder, password-field masking before a frame
  is sent, and the screencast stopped while the card is hidden
  (`browser_harness/screencast.py`, `AdaptiveController`, `LiveStream.set_visible`). Frames
  reach the dashboard over its WebSocket (`browser_harness/live_hub.py`).
- **Takeover.** `browser_harness/takeover.py:InputLock` is one lock per session, claimed with
  `POST /api/browser/input/claim`. While the person holds it, every agent op returns
  `user_in_control`. `dispatch_input` maps card events to CDP `Input.dispatchMouseEvent` and
  `Input.dispatchKeyEvent`, and keystrokes are never logged.
- **Session persistence.** By default all chats share the browser's default context and
  cookie jar. `browser.isolation: per_session` gives each chat an in-memory
  `Target.createBrowserContext`, disposed when the chat ends
  (`browser_harness/session_contexts.py`). Vault-backed login fill:
  `browser_harness/vault_fill.py`, `sign_in.py`. Governance kill switch:
  `capabilities.browse` (`browser_harness/governance.py`).
- **Optional Jev helper** (`browser.step`, `browser_harness/reflex*.py`) adapts code from
  `browser-use/jev-ultrafast` (MIT, `THIRD-PARTY-NOTICES` §"browser-use/jev-ultrafast").
- Tests: `test/` has 19 files matching `browser_harness`, plus `test_browser_decisions.py`.
- **CMDeck already has the core of this.** `apps/server/src/preview/ServerBrowser.ts` uses
  `playwright-core` with `Page.startScreencast` and `Input.dispatchMouseEvent`, there are
  browser profiles including incognito, a desktop guest browser in
  `apps/desktop/src/preview/*`, and `preview_*` MCP tools. **Recommendation: Existing —
  improve.** Borrow the _behaviours_ missing in CMDeck: an explicit input lock that makes
  agent ops fail fast while the human drives, password-box masking on streamed frames,
  ack-paced adaptive frame rate, and per-thread browser contexts. **Do not inherit** the
  default of attaching to the user's real Chrome profile over the remote-debugging port.
  That hands the agent every logged-in session the user has.

### TLS-02 Computer Use: Implemented on macOS and Windows; Linux is a typed refusal

- An MCP sidecar, `kirocrew-computer` (`mcp_computer.py`), feeds one sync chokepoint. The
  order of checks is: keystone enable file, governance, target policy, snapshot-index
  freshness, then the backend (`computer_use/__init__.py` docstring, `computer_use/gate.py`,
  `computer_use/policy.py`).
- It works **accessibility-tree first**. macOS uses AX plus CGWindowList/SkyLight via ctypes
  (`macos_ffi*.py`, `macos_skylight.py`, `capture_macos.py`). Windows uses UIA over COM via
  ctypes (`windows_ffi_uia.py`, `capture_windows.py`). Linux is `linux_driver.py`, a
  documented stub that refuses, with an AT-SPI/X11/Wayland plan in its docstring.
  Screenshots are saved to an owner-only temp dir and only their path is passed on.
- Live view: `computer_use/screencast.py` re-posts the frame the agent already captured to
  `/api/computer-use/frame`, which is relayed to the owner's sockets. It never starts a
  capture of its own.
- **Security note.** Computer use is **deliberately not governed**. It is a single operator
  opt-in stored in a keystone file (`computer_use.json`), and refusals are enforced in-band
  on tool dispatch (docs/architecture/security-deep-dive.md §Governance). The deny-app list,
  secure-text-field refusal and sensitive-text egress redaction in `policy.py` are the
  **only** control between the agent and the user's windows. The module's own docstring
  says this.
- Tests: 38 files match `computer_use`.
- **Recommendation: New — port or implement (behaviour only), low priority.** It is
  ctypes-heavy native code. In a TS/Electron app this would be a native helper or an MCP
  server. Keep it opt-in per environment, with an app deny list and secure-field refusal.
  Treat it as **no security boundary**.

### TLS-03 Markdown skills: Implemented+tested

- `skills.py:SkillsLoader` is a composition root over `skill_runtime/*` (catalog, search,
  delivery, versions, auto_skills) and `skills_*.py`. A skill is a `SKILL.md` tree
  (`skills_discovery.py`). Selection uses word-overlap triggers (`trigger_match`,
  `MIN_TRIGGER_OVERLAP`), with an optional Jev `skills.select` (TLS-06). Trust, provenance
  and pinning are handled in `skill_trust.py`, `skill_scope_pin.py` and
  `skills_builtin_provenance.py`. Script references are validated in
  `skills_script_validator.py`.
- **CMDeck/T3 note:** the harnesses CMDeck wraps (Claude Code, Codex and others) load
  `SKILL.md` natively. **Recommendation: Harness-provided — expose or integrate if needed.**
  Do not build a second skill loader. At most add a UI to browse and edit skills per
  environment.

### TLS-04 Lifecycle hooks: Implemented+tested

- `hooks.py` with `hook_runtime/*`. Events (`hooks.py` constants): `AgentSpawn`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionLaneChanged`,
  `PreTaskExecution`, `PostTaskExecution`, `FileCreated`, `FileEdited`, `FileDeleted`,
  `UserTriggered`. There are declarative rules and sandboxed script hooks
  (`hook_runtime/script_hooks.py:ScriptHookStore`) with stream caps and timeouts.
- `hook_runtime/hook_manager.py:HookManager.on_tool_call` is also **the gateway's own tool
  gate** (see INF-05). Hooks and policy share one chokepoint.
- **Recommendation: Partial — extend.** Script hooks overlap with harness-native hooks
  (Claude Code and Codex). The valuable part is a _server-side_ hook bus on orchestration
  events (turn start/stop, tool approval, file change), exposed as Effect service events that
  scheduled tasks and MCP can subscribe to. Do not copy the twelve-event Kiro IDE vocabulary
  one-for-one.

### TLS-05..08 Jev decision seam: Implemented+tested, feature preview, consent-gated

**What Jev is.** Jev is **a hosted third-party API**, not a local model: "Jev by TypeSafe",
default endpoint `https://api.typesafe.ai/v1/systemone`, model `jev-latest`
(`config/sections_decisions.py:DECISION_PROVIDER_ENDPOINT_DEFAULT`,
`decisions/impl_systemone.py:HOSTED_TYPESAFE`). `decisions/provider.py:_REGISTRY` lists four
providers:

| Provider           | Transport                                                                                                                                                                                                         | Egress                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `systemone-hosted` | HTTPS + API key from the vault                                                                                                                                                                                    | third party (TypeSafe; the same client also serves Cloudflare Workers AI "Clef") |
| `sagemaker`        | boto3 `sagemaker-runtime` `InvokeEndpoint` (SigV4), selected by a `sagemaker://name?region=&profile=` endpoint                                                                                                    | user's AWS (AWS-05)                                                              |
| `systemone-local`  | the same wire format on loopback; open-weight presets `plumb-4b`, `strands-decider-2b`, `laya` downloaded from a Kiro CloudFront CDN with sha256 pins (`decisions/local_models.py:MODEL_CDN`, `local_runtime.py`) | loopback; downloads weights once                                                 |
| `session-llm`      | one tool-less call on the session's own provider (`decisions/impl_llm.py`)                                                                                                                                        | whatever the session uses                                                        |

The question types are typed (`Choice`, `Noul` (yes/no), `Score`, `Box`) in `decisions/types.py`. Answers
are validated twice (provider, then `decisions/gate.py`). Every failure degrades to the
built-in rule: "everything is a refusal back to the baseline". Consent is stored on the
keystone floor (`decisions/consent.py`), with a **separate** consent scope for sending tool
arguments (`consent.consented_tool_args`) and per-session sampling.

- **TLS-05 model routing.** `decisions/points/model_route.py`: puts a user turn in one of three
  difficulty tiers, and each tier maps to a model id the owner pins. It runs only when the
  owner picks "Auto (decision model)" in the picker. Tiers ship unpinned, so the default
  behaviour is observe-only.
- **TLS-06 context selection.** `points/skills_select.py` (pick one skill or none),
  `points/memory_recall.py` (narrow vector-recalled memories), `points/compaction_keep.py`
  (_measures only_ which tool calls a compaction should have kept; the compaction itself is
  byte-identical).
- **TLS-07 wake decisions.** `points/nudge_wake.py` is subtractive: it may only _hold back_ an
  auto-nudge loop tick. Merged or closed PRs end the watch deterministically, outside the
  model. `points/message_steer.py` decides between steering and queuing a message sent into a
  running turn.
- **TLS-08 risk flagging.** `points/tool_risk.py`: **annotation only**. The docstring says the
  permission decision "is not consulted and not altered … an observation must never become a
  gate". It runs only in trusting or YOLO sessions. **Not a security boundary, and Kiro does
  not claim it is.**
- Tests: about 45 `test/test_decisions_*.py` files, including `test_decisions_impl_sagemaker.py`
  and `test_decisions_local_runtime_real_spawn.py`.
- **Recommendation (brief §9.5): New — port or implement as one small `DecisionService`**
  (Effect service) with typed questions, a provider registry (local OpenAI-compatible
  endpoint via existing providers, optional SageMaker, optional session model), consent,
  sampling, and "fallback = deterministic rule". Keep the design properties: subtractive
  wake gating, annotation-only risk, owner opt-in per point. **Do not inherit** the default
  hosted TypeSafe endpoint, the proprietary System One wire format as the only protocol, or
  Kiro-CDN model downloads. Use the local providers CMDeck already plans (CMD-07).

---

## INF: infrastructure and security

### INF-01 Remote Crew: Implemented (several transports, two of them hosted by Kiro)

Remote Crew is a family of transports, not one mechanism:

1. **Instances over SSH/SSM tunnels** (`instances/*`, flag `instances.enabled`, default on).
   `instances/ssh_tunnel_manager.py` supervises a foreground `ssh -N -L 127.0.0.1:LP:127.0.0.1:RP`
   child (multiplexing forced off), or `aws ssm start-session --document-name
   AWS-StartPortForwardingSession`. A remote dashboard token is minted by running `kirocrew
   token` over SSH (`instances/token_mint.py`) or over SSM `send-command`
   (`instances/ssm_token_mint.py`). The minted token is a bearer token of at most 20 hours.
   It transits SSM command history, which the docstring accepts as a trade-off.
2. **Kiro relay** (`relay_client/*`). The Crew dials out to a **Kiro-operated relay** over one
   `wss://` connection and multiplexes viewer HTTP and WS as frames (protocol v1). It holds a
   lease from a Kiro service (`relay_client/lease.py`, `RenewCrewLease`). Off unless
   `tunnel.relay_enabled` / `remote_control.hosting` is set.
3. **Kiro managed environments** (`managed_env/*`, `crew_client` feature preview). These are
   cloud machines created by the **Kiro web service** for a signed-in user, with Crew
   installed from `https://download.crew.kiro.dev/cli.sh` (`managed_env/install.py:PUBLIC_URL`).
4. **Self-launched AWS lanes**: EC2 (CloudFormation), Fargate, Lambda MicroVM (AWS-03).
5. **Connected computers** (preview, KCX-T01). A remote gateway drives a folder on the user's
   computer. Per-command `bwrap` + seccomp on Linux, and **unavailable on macOS and Windows**
   (`connected_computers/confinement.py`, `PLAN_LINUX = "linux-bwrap"`).
6. `tunnel/*` is a **stub in the OSS build** (`tunnel/__init__.py`: "Not available in the OSS
   build").

- Tests: 31 `instances`, 43 `relay`, 35 `connected_computers` files.
- **Compared with T3.** T3's ws server, pairing and environments already provide remote
  control, and CMDeck adds Tailscale and Cloudflare (CMD-02..05). The only piece worth taking
  is **SSM port-forward as an alternative transport to a user-owned EC2 host** (no inbound
  port, IAM-gated), and only under the optional AWS module. **Recommendation: Existing —
  retain (T3 remote).** **Do not inherit** the Kiro relay, managed environments, or token
  minting by shelling `kirocrew token` over SSH. T3 pairing is the right primitive.

### INF-02 Headless gateway: Implemented+tested

- `kirocrew gateway --headless` (`dashboard/headless.py`, `cli_gateway_boot.py`): the HTTP API
  without the SPA. **Always binds 127.0.0.1** when headless (`headless.bind_address`). Auth
  refusals return JSON. An HTTP API lives under `/v1`, shaped after OpenAI Responses
  (`/v1/responses`, `/v1/conversations`, `/v1/models`, `/v1/crew/*`), and **many endpoints are
  "Planned"** (`docs/reference/crew-api/README.md`). A Python client exists at
  `packages/kirocrew-client-py`.
- **Recommendation: Existing — retain.** T3's server is already headless (the `t3` command,
  desktop as host). Do not add a second REST API surface. If a stable programmatic API is
  needed, expose orchestration commands through the existing RPC contracts or MCP.

### INF-03 Snapshot and restore: Implemented+tested

- `snapshot.py` (facade), `snapshot_build.py`, `snapshot_archive.py`, `snapshot_restore.py`,
  `snapshot_merge*.py`. A tarball with `MANIFEST.json`, a component table, `--mode merge`
  or replace with rollback, extraction filters, and size bounds. Off-host copies are
  **redacted lossily**, with SQLite databases redacted value by value through SQL
  (`snapshot_redact.py`), and the manifest records the redaction. Nightly S3 backup is in AWS
  Control (`apps/builtins/aws_control/backend/backup.py`, `hooks.py`).
- Tests: about 100 `snapshot` files.
- **Recommendation: New — port or implement (behaviour).** An export/import of CMDeck state
  (copy `statev2.sqlite` + settings, without secrets by default) that fits the CMD-19/20
  migration framework. Keep three ideas: a manifest, redact-on-egress, and refusing to
  restore a bundle whose shape is wrong.

### INF-04 Crash and orphan recovery: Implemented+tested

- Spawned processes carry env markers (`constants.KIROCREW_SPAWNED_ENV`,
  `KIROCREW_SPAWN_HOME_ENV`, `KIROCREW_SANDBOX_TOOL_ENV`).
  `session_pid_orphan_scan.py:find_orphan_mcp_candidates` finds untracked children with a
  positive-identity predicate, and `session_pid_orphan_kill.py` kills them. One shared backoff
  ladder (`recovery/policy.py`, `recovery/ladder.py`) covers stub reconnect, backend respawn,
  ACP runtime rebuild, the gatewayd supervisor and task re-dispatch. Resource ceilings: cgroup
  v2 on Linux (`sandbox_cgroup.py`), Windows Job Objects (`platform_compat_winproc.py`), and
  only FD caps on macOS (docs/architecture/resource-protection.md **(docs-only)**).
- **Recommendation: Partial — extend.** T3 has provider session lifecycle. Adopt _env-marker
  identity for orphan sweeps_ (never kill by name pattern, which matches AGENTS.md rule 1) and
  one shared retry policy.

### INF-05 Independent permission policies: Implemented+tested. Enforced outside the model.

- The gate is Kiro's **own** PreToolUse chokepoint (`hook_runtime/hook_manager.py:HookManager.on_tool_call`),
  driven by ACP `session/request_permission`, and not the agent JSON's deny list. Order:
  sensitive-path and deny checks first, then governance, then auto-approve/trust/YOLO
  (security-deep-dive §How the layers compose; I spot-checked symbols but did not trace the
  full order).
- Governance is `effective = POLICY ∩ PROFILE`, tightest wins (`platform/governance_parts/*`).
  The policy is loaded from a trust root, and **Ed25519-signed policies** can be required
  (`platform/governance_parts/signature.py`, `ed25519_verify`). Per-Bot "held rules" force
  human approval for limits a migrated Bot cannot carry (`mate_held_rules.py`). Command rules
  come from `hook_runtime/denied_commands.py` (`BUILTIN_DENIED_RULES`).
- **Caveat:** enforcement depends on the harness _asking_. For Strands, Kiro had to inject a
  gate module so the CLI raises one interrupt per tool call (`acp/harness/strands.py`
  docstring). The docs call the PreToolUse gate "fail-open" in one place (security-deep-dive
  §Governance, computer-use note).
- **Recommendation: Partial — extend.** CMDeck has per-provider approval modes. Add a
  server-side policy evaluator (deny rules plus path floor) that runs on every provider
  approval request _before_ any auto-approve. That gives "agents cannot bypass via prompt"
  (brief §10). Signed enterprise policies: **Not selected**.

### INF-06 Encrypted secrets vault: Implemented+tested. The key is a plaintext file next to the store.

- `secrets/vault.py:SecretVault`: `<config_dir>/.vault/secrets.enc`, **AES-256-GCM per entry**
  (`cryptography`). The **key is a 256-bit file `<config_dir>/.vault/.vault_key`** (mode 0600
  on POSIX, SID-restricted on Windows via `platform_compat.restrict_to_owner`). **No OS
  keychain, DPAPI or Keychain.** Isolation from the agent is application-level, through the
  `.vault` keystone path floor, plus OS masking of the directory in every sandbox tier on
  Linux and macOS. On **Windows, where Kiro has no OS sandbox, a same-user shell can read the
  key file** if the regex gates miss it. The vault docstring says the bash gate blocks
  `python -c open(...)`. The newer security-deep-dive says the bash path regexes were
  **removed** (§Why the default is defensible). The docstring is stale.
- `derive_subkey(purpose)` derives HMAC subkeys for other mechanisms.
- **Notable: mediated secrets** (`secrets_mediation/dispatch.py`). The agent asks for an API
  call by secret _name_. The gateway checks owner authorization and an exact origin, vets and
  pins DNS, injects the secret in memory, sends with redirects disabled, and returns only a
  sanitized response. The plaintext never enters the agent context.
- **Recommendation: New — port or implement (behaviour).** Use the OS credential store
  (Electron `safeStorage` or keytar on desktop, libsecret or a file key fallback on headless
  Linux) to wrap the data key. Add **mediated injection** (secret name → server-side request
  or env injection for one spawn only). Do not copy "key file next to the ciphertext" as the
  default.

### INF-07 Credential redaction: Implemented+tested, but owner-facing seams are OFF by default

- `security/redaction.py:redact_credentials` uses a structured rule table
  (`security/redaction_structured/*`: vendor formats with checksums, JWTs, labelled values,
  encoded runs). It deliberately does **no entropy guessing**.
  `security/exfil.py:scan_exfiltration_urls` (request-blocking) and
  `redact_exfiltration_urls` handle URLs. `security/redaction_structured/stream.py:StreamRedactor`
  holds back a trailing credential-class run across stream chunks. An omission-detecting test
  registry covers every redaction call site (security-deep-dive §Layer 4 **(docs-only)** for
  the test).
- **`security/redaction_switch.py:DEFAULT_REDACTION_ENABLED = False`**: the owner setting that
  governs chat, the saved transcript, channel egress, prompt replay and the log filter is
  **off by default** (`redaction_seams.py`). Gates and the `ALWAYS_REDACTED` sites still
  redact.
- Tests: about 91 `redact` files.
- **Recommendation: New — port or implement (behaviour).** One redaction module in
  `packages/shared`, applied at log, export and tool-output egress. **On by default** for
  exports and logs. Include a streaming hold-back. The rule table is large. Start with
  high-signal vendor formats plus labelled values.

### INF-08 Chained security audit log: Implemented+tested. HMAC-chained, not signed.

- `sel.py:SecurityEventLog`: `<config_dir>/security_events.jsonl`, with each record
  **HMAC-SHA256** over the previous hash (`sel_append.py:_append_chained_locked`). The key is
  `trust/sel_hmac.key`, kept outside the log dir (`sel_trust_root.py`). Verification is at
  `GET /api/sel/verify`. Rotation starts **an independent chain per segment**: the rotation
  event names the closed segment but **not its final hash**, so deleting or truncating whole
  segments is not detectable from the chain. Retention is 365 days. Audit-or-deny applies to
  sandbox delegation, deny exceptions and internal sensitive reads.
- **Not signed.** A symmetric key held by the same OS user means any same-UID process that can
  read `trust/` can re-sign the chain. There is no external anchoring and **no audit UI**
  (security-deep-dive §Known gaps).
- **Recommendation: New — port or implement.** An append-only SQLite table (or JSONL) with a
  hash chain _across_ rotations, optionally periodic **signed checkpoints** (Ed25519 key in
  the OS keystore), plus a simple viewer. Describe it as tamper-evident, never tamper-proof.

### INF-09 OS sandboxing: Implemented on Linux and macOS. No OS sandbox on Windows.

| Platform                      | Mechanism (verified in source)                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux                         | **Not bubblewrap.** Custom launcher: fork → `unshare(CLONE_NEWUSER)` → uid/gid map → `unshare(CLONE_NEWNS)` → bind-mount empty dirs over hidden paths → exec, plus capability drop, `NO_NEW_PRIVS` and a seccomp-BPF filter (`sandbox.py` docstring, `sandbox_launcher_parts/exec_lockdown.py`). **No network namespace** (`CLONE_NEWNET` absent; it is a stated gap) and no PID namespace. cgroup v2 limits where delegation is available. |
| macOS                         | `sandbox-exec` Seatbelt profile that denies reads (`sandbox_seatbelt.py:_SEATBELT_PROFILE`), or delegation to kiro-cli's internal sandbox.                                                                                                                                                                                                                                                                                                  |
| Windows                       | **None.** Unconfined is allowed by platform default. Official kiro-cli spawns are "delegated" to kiro-cli's sandbox, which Kiro measured as **not** confining the KAS process: no AppContainer, no restricted token (`acp/harness/kas.py:_kiro_cli_sandbox_owns_relay` docstring). Job Objects only for process and memory limits.                                                                                                          |
| Connected computers (preview) | `bwrap` + seccomp on Linux only.                                                                                                                                                                                                                                                                                                                                                                                                            |

- **The default `standard` tier leaves `~/.aws`, `~/.ssh` and `~/.kube` readable** to shell
  commands (`sandbox.py` docstring, `sandbox_tiers.py`), so `cat ~/.aws/credentials`
  succeeds under defaults. `strict` masks them. The `cc` tier (Claude Code) exposes a
  read-only `~/.aws/config` for Bedrock.
- It hides **files** and does not restrict **egress**. Detached daemons escape the command
  lifetime. There is no in-sandbox canary check (security-deep-dive §Known gaps).
- **Recommendation: Alternative implementation — evaluate.** CMD-09 (per-thread Docker) and
  CMD-10 (Windows Sandbox) are the CMDeck answers. Kiro's Linux launcher is a credential-hiding
  file fence, **weaker than a container plus egress policy**, and Kiro offers nothing on
  Windows. Worth copying: tiered credential masks, fail-closed when no backend exists, an
  explicit audited opt-in to run unconfined, and env scrubbing of credential variables
  (`config/sections_agent_env.py`).

### INF-10 Usage limits and alerts: Implemented. Alerts only; no hard spend cap found.

- Plan-credit alerts at user percentages, once per plan period and account
  (`dashboard/handlers/plan_credit_alerts.py`, `telemetry.plan_alert_pcts`, default empty).
  Spend breakdowns come from local metrics (`dashboard/handlers/usage_spend.py`,
  `usage_cost.py`). Limit-reset parsing for provider "resets at…" messages is in
  `limit_reset.py`, and turn wall-clock limits in `turn_limit.py`. Kiro and Codex usage
  scrapers: `kiro_usage_api.py`, `codex_usage.py`.
- I found no global or per-session spend cap after grepping for `credit_cap`, `spend_cap`,
  `max_credits` and `credit_limit` (only `eval/tasks.py` matched).
- **Recommendation: Partial — extend** CMDeck/T3 usage display. Add threshold alerts and
  optional hard per-thread or workflow budgets enforced by the orchestrator, not by the
  model.

### INF-11 Alternative harnesses and ACP: Implemented+tested

- `acp/harness/`: `kiro` (default), `kas` (Kiro Agent Server relay), `claude`, `codex`,
  `copilot`, `deepseek`, `goose`, `opencode`, `pi`, `antigravity`, `mimocode`, `strands`
  (official `@strands-agents/cli` in ACP project mode with Kiro's injected gate). Registry:
  `agent_sdk/backends.py` (re-exported by `acp_backends.py`). Failover: `acp_failover.py`.
  `acp/` alone is 142k lines.
- **Recommendation: Existing — retain** (T3/CMDeck provider adapters; CMD-11). Two things are
  worth noting from Kiro: (a) _proving_ a gate loaded before trusting a harness's permission
  flow (the Strands read-back), and (b) vault-scoped provider keys withheld from the agent's
  shells.

### INF-12 Agent onboarding importer: Implemented+tested

- `onboarding_import.py` (`detect_sources`, `preview_import`, `apply_import`) with adapters in
  `onboarding_sources/`: `codex`, `claude_code`, `gemini`, `openclaw`, `hermes`,
  `amazon_quick`, `lineage`. Content screens live in `onboarding_scan.py`, plan in
  `onboarding_plan.py`, writers and ledger in `onboarding_apply.py`. It imports
  lessons/instructions, memories and schedules, with conflict strategies and a ledger.
- **Recommendation: New — port or implement** inside the CMD-19/20/21 migration framework.
  Keep preview → apply, the per-item ledger and content screening.

---

## DEV: developer applications (all built-in apps, `defaultEnabled: false`)

| ID     | App (path, size)                                                                                | What it does (verified in source/manifest)                                                                                                                                                                                                                                                                                                                | Tests                   | Recommendation                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DEV-01 | Code Review Sage `apps/builtins/code_review_sage` (12k lines; no `license` field in `app.json`) | Reviews GitHub PRs in an isolated agent session per PR, weighted by blast radius (`sage_lib/blast_radius.py`), produces a Focus Report, learns per repo (`learning.py`), posts a PENDING draft review only on `review.auto_post`, supports follow-up sessions loaded from the review transcript (`followup.py`)                                           | 53 in-app               | **Partial — extend** CMD-14/15/16 (PR review, batched comments, second-model review) as a workflow preset. Do not build a separate app.                                        |
| DEV-02 | Auto-Improvement `apps/builtins/auto_improvement` (26k lines)                                   | Measure first: calibrate a noise band (`calibrationReps`), prove a canary win, then keep-or-revert cycles in isolated worktrees with an edit allowlist and the repo's tests, survivors drafted as PRs/MRs (`spine/measurer.py`, `keeper.py`, `scope.py`, `bug_gate.py`, `driver*.py`)                                                                     | 94 in-app               | **New — port or implement (behaviour)** as a workflow: objective + baseline + allowlist + max iterations + revert. This matches brief §9.7 almost item for item.               |
| DEV-03 | Spec Builder `apps/builtins/spec_builder` (10k lines)                                           | Requirements → Design → Tasks markdown with an embedded agent, then hand-off to an execution session                                                                                                                                                                                                                                                      | 39 in-app               | **Partial — extend**: a plan-mode preset with markdown review and hand-off to a thread. No new app.                                                                            |
| DEV-04 | Design Tweak `apps/builtins/design_tweak` (4.4k lines, MIT)                                     | Injects `inject/select-to-edit.js` into a served or proxied preview, right-click element → scoped, source-mapped edit request to chat                                                                                                                                                                                                                     | 3 in-app, 12 in `test/` | **Partial — extend** CMDeck's preview (ServerBrowser/desktop guest) with element pick → DOM context + selector + screenshot into the composer.                                 |
| DEV-05 | Design Critique `apps/builtins/design_critique` (1.7k lines Python + skill, MIT)                | Mostly a skill. Renders URL, repo, Figma or screenshots with headless Chromium via Playwright (`capture-site.mjs`), defended by `--host-resolver-rules` pinning and `ssrf-guard.mjs`. A **cross-origin DNS-rebinding residual is accepted** (security-deep-dive §Known gaps, #17748)                                                                      | 12 in-app               | **Harness-provided / workflow preset** on the shared preview browser. Reuse the SSRF-guard idea.                                                                               |
| DEV-06 | Ops Mission Control `apps/builtins/ops_mission_control` (17k lines)                             | Polls CloudWatch, Datadog, PagerDuty, incident.io, GitHub issues, HTTP, webhook and schedule-file providers (`backend/providers/*`), claims signals, investigates in a watched chat, keeps a local ledger. Autonomy `observe` (default) / `propose` / `act`, where `act` requires per-pattern allowlist rules. The policy is stored on the keystone floor | 46 in-app               | **New — port or implement (behaviour), later**: inbound webhook (AUT-06) + scheduled poller + thread per incident + approval-gated remediation. Reuse scheduled tasks and MCP. |

Kiro admits some of these apps are coupled to Kiro-specific plumbing, such as chat-slot
APIs and kiro-cli `session/load` for follow-ups. Port behaviours, not code.

---

## AWS: AWS and cloud (AWS-01..05) and Bedrock beyond them

**Is AWS optional?** Mostly. The AWS Control app has `defaultEnabled: false`, and its
`hooks.py:on_startup` nightly-backup loop starts only on enable. The SageMaker decision
provider, SSM tunnels, Bedrock KB sources, Polly and Transcribe are inert until configured,
and boto3 is an optional extra. **Exception:** the core **deploy** package is not gated.
`dashboard/server.py` (around line 1010) always calls `deploy._register_core_skills`, which
copies the `artifact-deploy` and `deploy-web` skills into `<home>/skills/` at every gateway
start, and always registers the deploy routes. That is the kind of "visible clutter when
disabled" brief §6 forbids. I found **no startup credential discovery**: the account probe is
on-demand, `sts get-caller-identity` with a TTL cache (`aws_control/backend/accounts.py`).
This is not exhaustive; see Open questions.

**Call style.** Almost every AWS call **shells out to the `aws` CLI** through one chokepoint
(`cloud/aws.py:run_aws`, used by `deploy/engine.py`) with `--profile` and a sandboxed env, and
never boto3. boto3 is used only for SageMaker runtime (`decisions/impl_sagemaker.py`) and the
Bedrock KB `bedrock-agent-runtime` Retrieve (`knowledge/connectors/bedrock_kb.py`). Kiro
stores profile _names_, never key material.

**Paid-service consent.** `aws_consent.py`: per-account grants for `polly`, `transcribe`,
`s3`, `ce` and `bedrock-kb`, stored in keystone `aws_service_consent.json`, writable only by
the authenticated dashboard (no CLI verb, so an agent cannot grant itself spend). Note:
**EC2, Fargate, MicroVM and the deploy services (CloudFront) are not in `GATED_SERVICES`**.
Those paths are human-initiated from wizards and dashboard confirmations instead.

| ID                                   | Kiro implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | AWS APIs (as CLI verbs found in source)                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AWS-01 AWS Control**               | `apps/builtins/aws_control` (~72k lines incl. container runtime; MIT manifest). Account center: one health light per account, auth kind classified as `sso_session` / `sso_start_url` / `credential_process` with matched remedies such as `aws sso login --profile` (`backend/accounts.py`). Profile registry `~/.kiro/crew/deploy/profiles.json` (`deploy/profiles.py`). Costs: Cost Explorer month-to-date, cached daily (~$0.01/query), **budget thresholds evaluated locally, no AWS Budgets resource created** (`backend/costs.py`)                                                                    | `sts get-caller-identity`, `configure get/list-profiles/set`, `ce get-cost-and-usage`, `pricing get-products` (`deploy/pricing.py`, us-east-1)                                                                                                                              | 94 in-app tests + 36 in `test/`. Good UX ideas: auth-kind-specific reconnect guidance, local budget math.                                                                                                                  |
| **AWS-02 S3 cloud drive**            | `backend/storage*.py`, `library.py`, `shares.py`, `backup.py` + `backup_parts/*`. A bucket created only after consent with encryption, versioning, public-access block, ownership controls and tags. Presigned shares always expire, and a **ledger stores metadata, never the URL** (`shares.py`), with a SEL event per grant. Nightly snapshot backup to the same bucket                                                                                                                                                                                                                                   | `s3api create-bucket, put-bucket-encryption/versioning/tagging/policy/ownership-controls, put-public-access-block, head-bucket, list-buckets, list-object-versions, put/get/head/delete-object(s)`, `s3 cp/sync/rm`, `tagging get-resources`                                | The share-ledger honesty ("forget does not revoke") is worth keeping.                                                                                                                                                      |
| **AWS-03 EC2 launcher**              | `cloud/*` launches **Kiro Crew itself** onto the user's EC2 via CloudFormation (`cloud/templates/kirocrew-ec2.yaml`, `cloud/ec2.py`), with least-privilege IAM generation (`cloud/iam.py`), SSM by default and SSH as fallback (`cloud/connect.py`). Also a **Fargate** lane (`cloud/fargate/*`, `kirocrew-fargate-*.yaml`) and a **Lambda MicroVM** lane (`cloud/microvm/*`, Firecracker, hard max lifetime). Destructive verbs are denied to the agent by command rules (`cloud/__init__.py` docstring). I found **no auto-stop, idle shutdown or TTL** after grepping `cloud/ec2.py` and the EC2 template | `cloudformation deploy/describe-*/wait/delete-stack`, `ec2 describe-*/start/stop-instances`, `ssm start-session/send-command/get-command-invocation`, `ecs register-task-definition/run-task/stop-task/describe-tasks`, `lambda-microvms` (`run-microvm`, `get-microvm`, …) | 66 `cloud` tests, including a botocore model contract test for lambda-microvms (`pyproject.toml` dev group comment). I could not verify that Lambda MicroVMs exists or is generally available; treat it as **Unverified**. |
| **AWS-04 Artifact deployment**       | Core `deploy/*` (`engine.py`, `handlers_sites.py`, `render.py`, `scan.py`, `iam.py`): publishes an artifact (HTML, markdown, widget) to a **per-site S3 bucket + CloudFront distribution with OAC** in the user's account. Idempotent re-publish by tag, then sync and invalidate. The MCP `deploy_artifact` tool is **preview-only**, and execution is confirmed by a human in the dashboard (`deploy/DESIGN.md` header, which also says the body is historical)                                                                                                                                            | `cloudfront create-distribution-with-tags, create/get/delete-origin-access-control, get/update-distribution(-config), create-invalidation, delete-distribution`, `s3api`, `iam get-policy(-version)/delete-policy`                                                          | 65 `deploy` tests. **Ungated at startup** (see above).                                                                                                                                                                     |
| **AWS-05 SageMaker decision models** | **Client only.** `decisions/impl_sagemaker.py:SageMakerOracle` sends the System One JSON to a user-provided endpoint via boto3 `sagemaker-runtime` `InvokeEndpoint`, with its own retry within a budget and botocore retries off. Images need the `TypeSafe-Danger-Zone-Images` custom attribute. No endpoint provisioning (no `create-endpoint` in source)                                                                                                                                                                                                                                                  | `sagemaker-runtime:InvokeEndpoint`                                                                                                                                                                                                                                          | 2 test files. Useful only when paired with a model that speaks System One.                                                                                                                                                 |

**Bedrock beyond AWS-01..05 (`BRK-*`):**

- **BRK-INF.01. No native Bedrock provider.** Bedrock is reached only _through harnesses_:
  Claude Code (`cc` sandbox tier exposes `~/.aws/config` read-only), Codex (vendor builds), and
  the Strands CLI with the Bedrock provider using a **Bedrock API key**
  (`AWS_BEARER_TOKEN_BEDROCK`) stored in the vault (`agent_sdk/host_auth.py:bedrock_auth_remedy`,
  `config/sections_agent_env.py`). Model discovery, playground, inference profiles, batch and
  prompt-cache diagnostics: **not found**. `agent_sdk/backends_models.py` has a Strands Bedrock
  model-id vocabulary.
- **BRK-KB.01. Bedrock Knowledge Base retrieval** as a knowledge source (`bedrock_kb`). It runs
  live `Retrieve` at search time and merges hits with local results, is consent-gated
  (`bedrock-kb`), and attests rows in the sealed consent store because `knowledge.db` is
  agent-writable (`knowledge/connectors/bedrock_kb.py`). No KB management or ingestion.
- **BRK-AUTH.01.** Profile registry, SSO classification, an `sts` identity probe, and
  **project-directory → profile binding** that sets `AWS_PROFILE` per session cwd
  (`aws_project_profiles.py`; its docstring says "a guard … not an isolation boundary").
- **BRK-COST.01.** Cost Explorer, local budget thresholds, Pricing API estimates, and
  per-service paid consent (see above). **Not found:** per-thread AWS cost attribution or
  Service Quotas.
- **BRK-INFRA.01.** EC2, Fargate and MicroVM remote crews. CloudFormation-as-teardown-unit is a
  good pattern.
- **BRK-PRM / BRK-AGC: Absent** (no Prompt Management, Guardrails, Agents or AgentCore found
  by grepping for `bedrock-agent`, `guardrail`, `agentcore`).

**AWS recommendation.** Use Kiro as a source of **safety patterns**, not code:

- a single optional AWS module that is fully inert when disabled (including no skill install);
- one CLI or SDK chokepoint with `--profile`;
- store profile names only;
- per-service paid consent that agents cannot write;
- stack-per-resource teardown;
- Cost Explorer with local budgets;
- a share ledger;
- human confirmation for anything public or billable.

For the Bedrock user, the real gaps (native provider, model discovery, inference profiles,
Guardrails, AgentCore) are **not** in Kiro. See [AWS_BEDROCK.md](../AWS_BEDROCK.md).

---

## PRD: productivity apps

| ID                | Kiro                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests                   | Recommendation                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRD-01 Papyrus    | `apps/builtins/papyrus` (5k lines, Apache-2.0, `ATTRIBUTION.md` credits the original author "tricatte"). **LaTeX: yes.** Discovery order `pdflatex` → `tectonic` → user TeX Live. Runs bibtex cycles, parses compiler logs into clickable errors, passes `-no-shell-escape` explicitly, constrains `openout_any`, spawns through `sandbox.sandboxed_spawn_argv` + `create_subprocess_limited` with a wall-clock timeout (`backend/latex.py`). Git clone/commit/push is sandboxed with config hooks disabled (`backend/gitops.py`). The co-author is a chat session scoped to the paper | 8 in `test/`, 0 in-app  | **Partial — extend** CMDeck file preview: LaTeX compile action (tectonic preferred, no shell-escape, sandboxed, time-bounded) + PDF preview. No editor app.             |
| PRD-02 PPTX Maker | `apps/builtins/pptx_maker` (5.3k lines, MIT-0, credits "sktok"). Engine is [aws-samples/sample-spec-driven-presentation-maker](https://github.com/aws-samples/sample-spec-driven-presentation-maker) (MIT-0), **downloaded at install as a sha256-pinned tarball** into a uv venv, using **python-pptx** and driven by the agent over MCP (`@sdpm/*` tools) (`backend/engine.py`, `engine_source.py`). Spec, Vibe and Style agents, animated SVG preview                                                                                                                               | 7 in-app, 15 in `test/` | **Harness-provided / skill**: ship it as an optional MCP server or skill that writes `.pptx` into the thread's artifacts. Do not embed a Python venv manager in CMDeck. |
| PRD-03 Notes      | `apps/builtins/md_notebook` (5.3k lines). A markdown notebook in a git repo or an adopted folder such as an Obsidian vault, with `[[wikilinks]]`, backlinks, and sync = commit + pull + push that aborts on conflict (`git_ops.py`, `syncer.py`, `notes.py`)                                                                                                                                                                                                                                                                                                                           | 3 in-app, 14 in `test/` | **Partial — extend**: markdown viewer and editor in the file panel with wikilink/backlink rendering. Git sync can reuse existing git services.                          |

---

## MSG: messaging

A shared channel-neutral layer, `messaging/*`, implements `MessagingTransport` → `TurnDriver` →
`Renderer` (`messaging/transport.py`, `driver.py`, `renderer.py`), with an inbound spool,
queue receipts, approvals and egress redaction. Typed-reply approval for channels without
buttons (`messaging/approval.py`) denies on silence and binds each answer to one request id.
Who may answer is checked in the channel adapter, not here.

| ID              | Library and transport                                                                                                                                                                       | Auth and authorization                                                                                                                                                                                                                                        | Thread mapping and approvals                                  | Size and tests                                          | Recommendation                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MSG-01 Slack    | `slack-sdk` (a **core** dependency), **Socket Mode** via `slack_sdk.socket_mode.websockets.SocketModeClient` (`slack/gateway.py`). No public endpoint needed                                | Bot and app tokens. **Deny-by-default owner lock**: socket mode refuses to connect without an owner id. `slack.shared_access` is off by default. Enterprise Grid allowlist is **default-open** but fails closed on corrupt config (security-deep-dive §Slack) | Threads map to sessions. Trust and YOLO buttons are DM-only   | `slack/` is **182 files / ~101k lines**, 265 test files | **New — implement natively, small.** Socket Mode (Bolt-JS or `@slack/socket-mode`) + owner allowlist + thread→thread mapping + button approvals. Do not port 100k lines. |
| MSG-02 Telegram | Hand-written Bot API client with **long polling `getUpdates`** (`telegram/client_polling.py`). Streams by `editMessageText`, throttled to 1 s, with inline keyboards                        | Bot token, **`allowed_user_ids`**. An empty list logs a warning that the bot is globally reachable (`telegram/gateway.py`)                                                                                                                                    | DM-focused; inline-keyboard approvals                         | 30 files / 13k lines, 41 tests                          | **New — implement natively, small.** Long polling (no intermediary). Make an empty allowlist **refuse**, not warn.                                                       |
| MSG-03 Teams    | Bot Framework REST. **Inbound webhook** `POST /api/messaging/teams` on the gateway. Outbound `POST {serviceUrl}/v3/conversations/{id}/activities` (`teams/__init__.py`, `teams/gateway.py`) | JWT validation (issuer, App-ID audience, serviceUrl claim binding, replay drop) needs the **PyJWT extra**. Requires an Azure Bot registration and a **publicly reachable HTTPS endpoint** (tenant admin consent likely)                                       | DM-focused; card approvals (`teams/approvals.py`, `cards.py`) | 12 files / 7k lines, 23 tests                           | **Proposed — requires approval.** Inbound needs a public HTTPS URL (Cloudflare Tunnel, CMD-04) and an Azure app. Lowest priority.                                        |

Unselected channels present (KCX-T10): Discord, WhatsApp (`neonize`), Feishu, Webex, WeCom,
Weixin, iMessage.

---

## Security model reality check

| Claim area          | Reality in source                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "OS sandboxing"     | Linux: a custom user and mount namespace launcher + seccomp (**not** bubblewrap, **no** netns or pidns). macOS: Seatbelt `sandbox-exec`. **Windows: nothing** (unconfined by platform default; kiro-cli delegation measured as no AppContainer or restricted token). It is a credential **file fence**, not egress isolation. Under the default tier, `~/.aws`, `~/.ssh` and `~/.kube` are **readable** by shells. |
| Secrets vault       | AES-256-GCM. The **key is a plaintext 0600 file** in `.vault/`. No OS keystore. Protection from the agent is path-floor plus OS masking, so on Windows it is regex and path-gate only.                                                                                                                                                                                                                             |
| Redaction           | A serious rule-table engine with streaming hold-back, but **owner-facing seams default OFF** (`DEFAULT_REDACTION_ENABLED = False`). It never sees bytes a subprocess sends by itself.                                                                                                                                                                                                                              |
| Audit log           | **HMAC-chained**, with a symmetric key under `trust/`. **Not signed** and not externally anchored. Chains restart per segment, so segment deletion goes undetected. No UI.                                                                                                                                                                                                                                         |
| Permission policies | Enforced by **Kiro's gateway**, independent of the model and the agent config, before auto-approve. Signed policy documents (Ed25519) are optional. It depends on the harness emitting permission requests.                                                                                                                                                                                                        |
| Command deny rules  | Regex and tokenizer, "not a shell parser" (Kiro's words). Exfil-shape checks are "defence in depth, not a boundary".                                                                                                                                                                                                                                                                                               |
| Jev                 | **Remote third-party API** by default (TypeSafe), or optional local or SageMaker. Consent-gated, off unless the owner opts in.                                                                                                                                                                                                                                                                                     |
| Risk flagging       | **Annotation only.** It never gates anything. Correctly not a boundary.                                                                                                                                                                                                                                                                                                                                            |
| Computer use        | **Ungoverned** by design. In-band app and field policy only.                                                                                                                                                                                                                                                                                                                                                       |
| Browser             | The default drives the **user's real Chrome profile** via CDP. Design Critique has an accepted DNS-rebinding residual.                                                                                                                                                                                                                                                                                             |
| Launcher integrity  | `kiro-cli` is executed with no signature or hash check. Accepted (same-UID threat out of scope).                                                                                                                                                                                                                                                                                                                   |

Kiro's own docs state almost all of these limits honestly
(`docs/architecture/security-deep-dive.md` §Known gaps). Treat them as the honest baseline,
not as stronger guarantees.

## Telemetry and phone-home (privacy-relevant)

- **Product metrics to Kiro are ON by default.** `metrics/kiro_export.py`: the built-in
  destination `https://telemetry.us-east-1.kiro.dev/v1/metrics`, which "config cannot remove
  or repoint". It exports whenever local recording is on, and recording is on by default
  (`config/sections_telemetry.py:TelemetryConfig.enabled = True`). Header `x-kiro-machineid`
  carries a SHA-256 of the install id. It can be disabled with `telemetry.enabled: false`,
  `KIROCREW_TELEMETRY=0` or `DO_NOT_TRACK`. It is absent in LTS builds and CI.
- **Daily anonymous beacon ON by default.** `beacon.py` sends to
  `https://d175o3ylxqum0e.cloudfront.net` (`beacon_enabled = True`) with five fields: random
  install id, version, Python minor, channel and a first-run bit.
- Other vendor endpoints in source: `updates.crew.kiro.dev` and `download.crew.kiro.dev`
  (`platform/update_layout.py`), `apps.crew.kiro.dev` (app catalog), feature videos and the
  embedding model on `d3j0sthz5doyui.cloudfront.net`, decision-model weights on
  `dostcaqwrph3m.cloudfront.net`, `api.typesafe.ai` (Jev), the Kiro relay, lease and managed
  environment services, `kas.crew.kiro.dev`, `management.*.kiro.dev`, and
  `prod.us-east-1.auth.desktop.kiro.dev`. I did not trace when each one is contacted.
- Opt-in only: OTLP export to user collectors (`tracing/`, `telemetry.otlp_endpoint`) and an
  X-Ray traces endpoint constant.
- **All of these are EXC for CMDeck.**

## What NOT to inherit (summary)

1. Default telemetry, the beacon, the built-in un-repointable metrics destination, the update
   endpoints, and Kiro-hosted relay, managed environments and app catalog.
2. Attaching agents to the user's real browser profile by default.
3. A vault key stored as a plaintext file beside the ciphertext. Owner-facing redaction off by
   default.
4. A credential-file fence described as "OS sandboxing" when Windows has none and there is no
   egress control.
5. Ungated AWS surfaces (deploy skills and routes installed at every start).
6. Dependence on a proprietary hosted decision API (System One/Jev) as the default.
7. Architecture: the facade-mirror monkeypatch indirection, giant per-channel stacks (Slack
   ~101k lines), a separate in-gateway "app" framework for each tool, and a second public REST
   API. CMDeck should use Effect services + contracts + MCP + workflow presets.
8. Token minting by shelling `kirocrew token` over SSH or SSM (the bearer token transits SSM
   history).

## Ledger entries (proposed for RESEARCH_LEDGER Log; not written there per my write scope)

- 2026-11-26 [kiro-tools-infra] completed — TLS/INF/DEV/AWS/PRD/MSG audited at
  `kirocrew@b75544f0db`; see `research/kirocrew-tools-infra-apps.{md,csv}` (high).
- decision (proposed) — Jev (TLS-05..08) → one local-first `DecisionService`; hosted TypeSafe
  default is EXC (medium).
- finding — Kiro ships default-on product telemetry to `telemetry.us-east-1.kiro.dev` and a daily
  beacon; record as EXC (high).
- finding — Kiro has no Windows OS sandbox; INF-09 does not satisfy CMD-09/10 (high).
- conflict — TLS-01 overlaps CMDeck's existing Playwright preview (`ServerBrowser.ts`); the CMDeck
  agent should confirm the takeover state (medium).
- New IDs: BRK-INF.01, BRK-KB.01, BRK-AUTH.01, BRK-COST.01, BRK-INFRA.01; KCX-T01 Connected computers,
  KCX-T02 Kiro relay + managed environments (exclude), KCX-T03 telemetry/beacon (exclude, EXC),
  KCX-T04 Crew `/v1` Responses-style API, KCX-T05 voice (Polly/Transcribe, paid AWS),
  KCX-T06 signed governance policies, KCX-T07 mediated secret dispatch, KCX-T08 AWS project→profile
  binding, KCX-T09 Share My Crew container packaging, KCX-T10 other messaging channels.

## Open questions

1. Is AWS fully inert when disabled? The deploy skill install and routes are unconditional. I
   did not check whether any dashboard page or skill probes AWS when opened without the app
   enabled, or whether `aws_project_profiles` reads anything when unmapped (its docstring
   says no).
2. Does the "Kiro telemetry" destination actually send on a first run before any notice is
   shown? The docstring says "No acknowledgement is waited for". The
   `kiro_telemetry_ack_version` config field text suggests otherwise. Needs a runtime trace
   (not allowed here).
3. Lambda MicroVM (`lambda-microvms`) service availability and GA status: unverified against
   AWS docs.
4. The browser-harness (browser-use) license was not verified; it is pip-installed at runtime
   and not vendored.
5. Licenses of Code Review Sage, Auto-Improvement, Spec Builder, Ops Mission Control and Notes:
   `app.json` has no `license`. Presumably the repo's Apache-2.0 applies.
6. The exact gate order in `HookManager.on_tool_call` was taken from the docs and not traced
   line by line.
