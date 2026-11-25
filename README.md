# CMDeck

CMDeck is a personal, **unofficial** fork of [T3 Code](https://github.com/pingdotgg/t3code), the
open-source GUI for coding agents. It is not affiliated with, endorsed by, or maintained by
T3 Tools, Inc.

It runs the coding agents on your machine (Claude Code, Codex, Cursor, OpenCode, Grok Build,
Antigravity, Kiro, Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent) behind one
interface on desktop, web, and phone. What this fork adds on top of upstream:

- No telemetry, crash reporting, or hosted relay.
- Its own identity: data in `~/.cmdeck` (`CMDECK_HOME`), app ID `com.tehcnological.cmdeck`,
  background service `cmdeck`, default port 3783. It installs and runs next to the official
  T3 Code without sharing state.
- A `cmdeck` command (the upstream `t3` command still works).

## Install

There are no hosted downloads, and the `t3.codes` installers, `npx t3`, and T3 Code's releases
install the official T3 Code, not this fork. The installers in `scripts/` take a CMDeck build from
your own mirror (laid out as `<mirror>/v<version>/SHA256SUMS` plus the platform archives) and stop
if none is set:

```bash
T3CODE_RELEASE_BASE_URL=https://mirror.example/cmdeck T3CODE_VERSION=1.2.3 scripts/install.sh
```

```powershell
$env:T3CODE_RELEASE_BASE_URL = "https://mirror.example/cmdeck"; $env:T3CODE_VERSION = "1.2.3"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Build the desktop app from source; see [docs/user/install.md](./docs/user/install.md) and the
[user docs](./docs/README.md).

## Staying current with upstream

This fork merges upstream T3 Code on demand. See
[docs/operations/fork-upstream-sync.md](./docs/operations/fork-upstream-sync.md) for the merge
steps, the fork guard, and the list of what was renamed for CMDeck.

## License and credit

CMDeck is built on the T3 Code source code by T3 Tools, Inc., used under the
[MIT License](./LICENSE). The MIT License covers the source only; the T3 Code name, logos, and
icons are T3 Tools' trademarks (see [TRADEMARK.md](./TRADEMARK.md)) and are not used for this
fork's branding.
