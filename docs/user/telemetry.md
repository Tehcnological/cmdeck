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
- **T3 Connect**: when you link environments, traffic rides a Cloudflare tunnel (`cloudflared` on
  your machine) through the T3 Connect relay. The relay sets up the link; it does not proxy your
  HTTP or WebSocket sessions.
- **Agent activity for mobile notifications**: when **Publish agent activity** is on under
  **Settings > Sharing & access**, the host sends project and thread titles, model names, activity
  status, and environment and thread identifiers to the T3 Connect relay for
  [mobile notifications and live activities](./mobile-notifications.md). Turn it off there.
- **Model catalog updates** from `raw.githubusercontent.com` (the CMDeck repository), about once
  an hour while provider status is checked, and again after a provider update or a model cache
  refresh. **Provider update checks** also look up newer provider CLI versions on the npm registry.
  Turn both off with **Settings > Maintenance > Provider update checks**; new models may then not
  appear until you update CMDeck.
- **Model prices** from LiteLLM's public price table on `raw.githubusercontent.com` (falling back
  to `api.github.com`), at most once a day, when you open **Usage**. Prices are cached on disk.
  There is no switch; if you never open Usage, it is never fetched.
- **CMDeck release lookups** on the npm registry (or your configured npm registry) when you open
  the dialog to switch update tracks.
- **Desktop app updates**: packaged desktop builds with an update feed check it 15 seconds after
  start and every 4 minutes. Set `T3CODE_DISABLE_AUTO_UPDATE=1` to turn this off.
