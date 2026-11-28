# Telemetry and network calls

This build of CMDeck has no telemetry. The server, desktop app, web app, and mobile app send no
product analytics, crash reports, traces, metrics, or logs to anyone, and nothing turns them on:
the code that collected and sent them has been removed, along with `T3CODE_TELEMETRY_ENABLED`, the
OpenTelemetry export settings, and the managed-policy telemetry switch. No install, device, or
account identifier is sent for analytics, and CMDeck does not read your Codex or Claude credential
files to identify you.

Diagnostics stay on your devices: server logs and provider event logs under `~/.cmdeck/logs`, process
CPU and memory history in **Settings > Maintenance > Diagnostics**, and the crash log in the mobile
app's **Settings > About CMDeck > Diagnostics**, which you can copy and share yourself.

## Agent feedback

Agent feedback in **Settings > Labs** still lets agents write reports about CMDeck
problems, and `t3 feedback list` shows them. Reports are saved on your machine only; none is sent,
and a report card's **Send** keeps the report local and marks it not sent.

## Network calls CMDeck makes

Besides the traffic you or your tools create, these are the outbound calls CMDeck makes:

- **Provider traffic**: your prompts, replies, and file context go to the model providers you
  configure (Anthropic, OpenAI, and so on), under their own privacy policies. In a Codex thread,
  `/feedback` uploads that conversation and Codex logs to OpenAI, only when you send it.
- **Site icons**: off by default. With **Settings → Appearance → Show site icons** on, link,
  browser-tab and agent tool icons load from each site itself (`<site>/favicon.ico`, or the
  provider's logo URL for a tool). No third-party icon service is used.
- **Model catalog updates**: `model-manifest.json` from the CMDeck repository
  (`raw.githubusercontent.com/Tehcnological/cmdeck`), which receives T3 Code's catalog through
  upstream merges. It is fetched about once an hour while provider status is checked, and again
  after a provider update or a model cache refresh. **Provider update checks** also look up newer
  provider CLI versions: on the npm registry, or for natively installed CLIs on each vendor's own
  release host (`downloads.claude.ai`, `releases.openai.com`, `releases.fx.sh`, and Google Cloud
  Storage for Antigravity). Turn both off with **Settings > Maintenance > Provider
  update checks**; new models may then not appear until you update CMDeck.
- **Model prices** from LiteLLM's public price table on `raw.githubusercontent.com` (falling back
  to `api.github.com`), at most once a day, when you open **Usage**. Prices are cached on disk.
  To stop it, set `"usagePriceDownload": false` in `~/.cmdeck/userdata/settings.json`; Usage then
  prices only from the saved table and your [custom prices](./usage.md#custom-model-prices-and-filtering).
- **Claude reset credits**: for a Claude instance signed in with a subscription, each provider
  status check asks `api.anthropic.com` how many reset credits the subscription has banked, using
  that instance's own sign-in. Turn it off per instance with **Check reset credits** in the Claude
  provider settings. Usage limits still come from Claude itself.
- **Desktop app update checks**: the desktop app looks for a newer CMDeck release on
  `github.com/Tehcnological/cmdeck` about 15 seconds after it starts, every 4 hours, and when you
  check by hand, and downloads the update from there when you choose to. Turn off the automatic
  checks with **Settings → About → Check for updates automatically**; see
  [Updating CMDeck](./updating.md#desktop-app-updates).
- **Spellcheck dictionaries (Linux desktop app)**: spellcheck is off by default on Linux, where
  turning it on downloads spelling dictionaries from Google's servers. Turn it on with
  **Settings → General → Spellcheck**. Windows and macOS use the system spellchecker instead.
- **Health monitoring probes**: off by default. With **Settings > General > Health monitoring**
  on, the probes you list there are checked once a minute, and linked environments only when you
  turn on **Check linked environments**. Nothing else is contacted.
- **Server update checks**: `t3 update` and the mobile app's server update check look up the newest
  release on CMDeck's GitHub releases (`github.com/Tehcnological/cmdeck`, then `api.github.com` if
  needed). CMDeck installs updates only from a build mirror you configure.

Agents run with their own telemetry off: CMDeck starts provider processes with `DO_NOT_TRACK`,
`DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `OPENCODE_DISABLE_TELEMETRY` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set (the last also stops Claude Code updating itself
from inside CMDeck). A value you set in your own environment or a provider instance wins.

CMDeck does not use T3 Connect or its relay, does not look up its own releases on the npm
registry, and never checks T3 Code's releases for desktop updates.
