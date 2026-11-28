# CMDeck

CMDeck is a personal, **unofficial** fork of [T3 Code](https://github.com/pingdotgg/t3code), the
open-source GUI for coding agents. It is not affiliated with, endorsed by, or maintained by
T3 Tools, Inc.

It runs your coding agents (Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro,
Pi, Muse Code, fx, and any [ACP](./docs/user/providers-acp.md) agent) behind one interface on
desktop, web, and phone, with the subscriptions you already have. Local models are an optional
add-on.

## What this fork adds

- **Privacy.** No telemetry, crash reporting, or hosted relay. Agents CMDeck starts are asked not
  to send telemetry either.
- **Its own identity.** Data in `~/.cmdeck` (`CMDECK_HOME`), app ID `com.tehcnological.cmdeck`,
  background service `cmdeck`, default port 3783, and a `cmdeck` command (`t3` still works). It
  installs and runs next to the official T3 Code without sharing state.
- **Updates from its own releases.** The desktop app [updates itself](./docs/user/updating.md#desktop-app-updates)
  from this repository's releases, never from the official T3 Code.
- **Remote access you control.** Tailscale, or your own Cloudflare Tunnel set up in
  **Settings → Sharing & access**. New devices wait for your approval.
- **Optional [end-to-end encryption](./docs/user/encrypted-remote-control.md)** between CMDeck's
  own clients and your machine, so a tunnel in between cannot read your threads.
- **Remote MCP** with tokens you create, so other apps can drive CMDeck.
- **Local models as an add-on.** Point agents at LM Studio, Ollama, llama.cpp and similar servers
  through CMDeck's [local model gateway](./docs/user/local-models.md).
- **More integrations:** second-model review, batched diff comments, an opt-in CI feedback loop,
  the Oh My Pi agent, Vikunja and Gitea/Forgejo issues, LLM Gateway, and a complete uninstall.

The official T3 Code mobile apps pair with CMDeck as with any T3 Code server.

## Install

Download the installer from [Releases](https://github.com/Tehcnological/cmdeck/releases):

| System                | File                                                     |
| --------------------- | -------------------------------------------------------- |
| Windows x64           | `CMDeck-<version>-x64.exe`                               |
| macOS (Apple silicon) | `CMDeck-<version>-arm64.dmg`                             |
| Linux x64             | `CMDeck-x86_64.AppImage` or `CMDeck-<version>-amd64.deb` |

The builds are not signed: Windows SmartScreen asks before running the installer, and macOS blocks
the first open until you allow it in **System Settings → Privacy & Security**. On macOS, move
CMDeck to Applications so it can update itself. `SHA256SUMS.txt` on each release lists the
checksums.

Coming from T3 Code? Quit both apps and run `cmdeck import-from-t3` to bring over your threads,
projects, settings and sign-ins; see [Import from T3 Code](./docs/user/import-from-t3-code.md).

The `t3.codes` installers, `npx t3`, and T3 Code's releases install the official T3 Code, not
CMDeck. To install only the command-line server, or to build from source, see
[docs/user/install.md](./docs/user/install.md) and the [user docs](./docs/README.md).

## Staying current with upstream

This fork merges upstream T3 Code on demand. See
[docs/operations/fork-upstream-sync.md](./docs/operations/fork-upstream-sync.md) for the merge
steps, the fork guard, and the list of what was renamed for CMDeck. Releases are published by
tagging `vN`; see [docs/operations/03_release.md](./docs/operations/03_release.md).

## License and credit

CMDeck is built on the T3 Code source code by T3 Tools, Inc., and includes work ported from
[m3code](https://github.com/MiaAI-Lab/m3code) by MiaAI-Lab, both used under the
[MIT License](./LICENSE). It also adapts parts of [Kiro Crew](https://github.com/kirodotdev/KiroCrew)
by Amazon (Apache License 2.0), [LiteLLM](https://github.com/BerriAI/litellm) (MIT),
[OpenClaw](https://github.com/openclaw/openclaw) (MIT) and
[Sillage](https://github.com/MarlBurroW/sillage) by MarlBurroW (MIT); see
[Open source licenses](./docs/user/open-source-licenses.md). The MIT License covers the source only; the
T3 Code name, logos, and icons are T3 Tools' trademarks (see [TRADEMARK.md](./TRADEMARK.md)) and are not
used for this fork's branding.
