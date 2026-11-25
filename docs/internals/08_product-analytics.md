# Product analytics

This fork has no product analytics, crash reporting, or telemetry export, and nothing can turn them
back on. Keep it that way:

- **Nothing leaves the machine for observation.** Do not add analytics, crash reporting, OTLP
  exporters, or trace forwarding to the server, desktop, web, or mobile apps. Local logs, local
  resource monitoring, and in-process metrics are fine.
- **No identifiers for counting people.** Do not hash or send install, device, or account IDs, and
  do not read provider credential files (`~/.codex/auth.json`, `~/.claude.json`) to identify users.
- **Stay wire-compatible with upstream clients.** The official apps decode `ServerConfig.observability`
  as required, so the server sends it with every signal off. The managed-policy `telemetry` limit is
  still accepted so existing policy files load, and does nothing.
- **Agent feedback reports stay local.** They are stored and listed, never sent.

The user-facing list of the network calls T3 Code does make is [telemetry.md](../user/telemetry.md).
Keep it current when adding an outbound call.
