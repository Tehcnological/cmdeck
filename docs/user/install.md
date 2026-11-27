# Install CMDeck

CMDeck runs coding agents on your computer (or server) and lets you control them from the desktop app, web app, or mobile app. Install CMDeck on the machine where your agents will run first.

> [!NOTE]
> CMDeck is an unofficial fork of T3 Code. Its desktop app is on
> [CMDeck's GitHub releases](https://github.com/Tehcnological/cmdeck/releases). The `t3.codes`
> installers, `npx t3`, the `t3` npm package, and T3 Code's GitHub releases and package-manager
> entries all install the official T3 Code, not CMDeck. For the command line, install CMDeck from
> builds you host yourself, as described below. The installer adds both a `cmdeck` and a `t3`
> command. CMDeck keeps its data in `~/.cmdeck` (set `CMDECK_HOME` to move
> it) and its server defaults to port 3783, so it can run next to the official T3 Code.

## Requirements

You need at least one installed, authenticated coding agent (provider) before starting a thread. You can launch CMDeck first and set up providers from the [Welcome page](./welcome-page.md) or **Settings → Providers**.

## Command line

The installers in `scripts/` download a CMDeck build from your own mirror: any HTTP(S) server
laid out as `<mirror>/v<version>/SHA256SUMS` next to `t3-<version>-<platform>-<arch>.tar.gz`
(`.zip` on Windows). Set `T3CODE_RELEASE_BASE_URL` to the mirror and `T3CODE_VERSION` to the
version to install; without them the installer stops instead of downloading anything.

```bash
# macOS / Linux
T3CODE_RELEASE_BASE_URL=https://mirror.example/cmdeck T3CODE_VERSION=1.2.3 scripts/install.sh
```

```powershell
# Windows (PowerShell)
$env:T3CODE_RELEASE_BASE_URL = "https://mirror.example/cmdeck"
$env:T3CODE_VERSION = "1.2.3"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The installer checks the archive against `SHA256SUMS` and installs the `t3` and `cmdeck` commands to `~/.local/bin`. If that folder is not on your `PATH` yet, it says so and, for zsh, bash on Linux, and fish, prints a command to add it. On Windows, `t3` works in the same PowerShell window right away; add the folder to your `PATH` for new windows. If a `t3` that the installer or the desktop app did not create is already there, it leaves that one alone and stops.

| Task                          | Command                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| Start server and open web app | `t3` (or `t3 ./my-project`)                                             |
| Start server without browser  | `t3 serve`                                                              |
| Set up remote access          | `t3 up` ([Remote access](./remote-access.md))                           |
| Run in the background         | `t3 service install` ([Background service](./background-service.md))    |
| Update                        | `t3 update`                                                             |
| Reclaim database space        | `t3 doctor` ([Details](./background-service.md#reclaim-database-space)) |
| Uninstall                     | `t3 uninstall` ([Details](#uninstall-cmdeck))                           |

If `t3` reports a server is already running, connect with `t3 pair` or pass a separate `--base-dir`. Run `t3 --help` for all commands.

### Intel Macs

There is no standalone `t3` binary or desktop build for Intel Macs—build a server from source with `vp` ([development runbook](../operations/00_development.md#first-checkout)):

```bash
git clone https://github.com/Tehcnological/cmdeck
cd cmdeck && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

## Desktop app

Download the installer for your computer from
[CMDeck's releases](https://github.com/Tehcnological/cmdeck/releases): the `.exe` for Windows x64,
the `.dmg` for Apple silicon Macs, or the `.AppImage` or `.deb` for Linux x64. The builds are not
signed: Windows SmartScreen asks before running the installer, and macOS blocks the first open
until you allow it in **System Settings → Privacy & Security**. Move CMDeck to Applications on
macOS so it can update itself. The app then [updates itself](./updating.md#desktop-app-updates)
from the same releases. The T3 Code releases, `winget`, Scoop, Homebrew, AUR, and nixpkgs packages
all install the official T3 Code. You can also build the desktop app from a CMDeck checkout
([development setup](../operations/00_development.md#first-checkout)).

On Linux, spellcheck starts off, because turning it on downloads spelling dictionaries from Google.
Turn it on in **Settings → General → Spellcheck**.

### The `cmdeck` command

The desktop app bundles the command-line tool as `cmdeck`, with `t3` as a second name, and sets it up on first launch (manage anytime under **Settings → About → cmdeck command**). On macOS and Linux it adds a `cmdeck` link in `~/.local/bin` (or `~/bin`), and a `t3` link beside it when no other `t3` is there; on Windows it adds the app's command folder, which holds both, to your `PATH`. Use **Add to PATH** if needed, then open a new terminal. Another `t3`, such as the official T3 Code's, stays as it is; use `cmdeck` for CMDeck.

- **Open a folder in the running desktop app**: Run `t3 app` (or `t3 app ../my-project`) from a terminal, or drag folders from your file manager onto the desktop sidebar.

### Windows Subsystem for Linux

Select a WSL distro in **Settings → Sharing & access** to run agents and projects inside WSL (install provider CLIs inside that distro). CMDeck manages its own server runtime inside WSL automatically.

## Mobile app

Install from the [App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code) (QR codes are also in **Settings → About → Mobile app**). The mobile app connects to a server on another machine with a pairing link via [remote access](./remote-access.md).

- Store builds work with both Stable and Nightly servers. Optional Android beta APKs are under [Android beta releases](https://github.com/pingdotgg/t3code/releases?q=android-beta-).
- If the mobile app crashes on launch, open **Settings → Diagnostics** on the next launch to copy recent startup crash reports.

## Providers

Open **Settings → Providers** (web or desktop), select the environment, and enable the providers you use. Installation and sign-in always happen on the **environment's machine**.

| Provider         | Install and authenticate                                                                                                 | Guide                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Codex**        | Connect with ChatGPT in Settings, or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. | [Codex](./providers-codex.md)             |
| **Claude**       | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`.                               | [Claude](./providers-claude.md)           |
| **Cursor**       | Sign in in Settings or install [Cursor CLI](https://cursor.com/cli) and run `agent login`.                               | [Cursor](./cursor.md)                     |
| **Grok Build**   | Install [Grok Build CLI](https://x.ai/cli) and run `grok login`.                                                         | [Grok](./providers-grok.md)               |
| **Antigravity**  | Install managed runtime and sign in with Google in Settings.                                                             | [Antigravity](./providers-antigravity.md) |
| **OpenCode**     | Install [OpenCode](https://opencode.ai) and run `opencode auth login`.                                                   | [OpenCode](./providers-opencode.md)       |
| **Kiro**         | Install [Kiro CLI](https://kiro.dev/docs/cli/) and run `kiro-cli login`.                                                 | [Kiro](./providers-kiro.md)               |
| **Pi**           | Install [Pi](./providers-pi.md) (Node.js 22.19+) and run `pi` → `/login`.                                                | [Pi](./providers-pi.md)                   |
| **Muse Code**    | Install [Muse Code](https://dev.meta.ai/docs/muse-code) and run `muse login`.                                            | [Muse Code](./providers-muse.md)          |
| **fx**           | Install [fx](https://fx.sh) and run `fx login`.                                                                          | [fx](./providers-fx.md)                   |
| **ACP Registry** | Add GitHub Copilot and other agents in **Settings → Providers → Add provider → Show more**.                              | [ACP](./providers-acp.md)                 |

- **Binary path**: If a CLI isn't on the server's `PATH` (common with version managers), set **Binary path** in the provider's settings.
- **Updates**: Click **Update now** on outdated provider cards (supports Homebrew, mise `latest`, npm/pnpm/Yarn/Bun/Volta/Vite+, or the CLI's own updater; update Nix, Chocolatey, or pinned mise installs manually).
- **Multiple instances**: Add extra provider instances for separate accounts, API keys, or custom endpoints (mark secret env vars as sensitive).
- **Local models**: Point Pi, OpenCode, Claude, or Codex at a local inference server. See [Local models](./local-models.md).

### Provider check timeouts

If a working CLI times out during CMDeck's readiness check, increase its probe deadline (in milliseconds) in the server's environment (or systemd override / `service.env`) and restart:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 t3 serve
```

| Provider     | Environment variable                   |
| ------------ | -------------------------------------- |
| Codex        | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude       | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor       | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity  | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok         | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro         | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx           | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi           | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code    | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode     | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

### Data folder on a network or synced drive

CMDeck memory-maps up to 256 MiB of its database for faster reads. Memory
mapping is unsafe when the data folder is on a network share (SMB, NFS) or in a
cloud-synced folder (OneDrive, Dropbox, iCloud Drive, Google Drive): a dropped
connection or a sync can crash the server or damage the database. CMDeck turns
it off for UNC paths and those sync folders on its own. For any other network
mount, turn it off yourself and restart the server:

```bash
T3CODE_SQLITE_MMAP_BYTES=0 cmdeck serve
```

The value is the mapping size in bytes; `0` turns it off. A value that is not a
whole number also turns it off.

## Uninstall CMDeck

In the desktop app, open **Settings → About** and choose **Uninstall…**. The dialog lists exactly
what will go. **Remove app only** keeps your threads, settings and sign-ins, so a later install
picks up where you left off; tick **Also remove all CMDeck data** to delete those too. CMDeck then
quits and finishes on its own. On Windows the app's own uninstaller opens to remove the program.

From a terminal:

| Removes                                                         | Command                  |
| --------------------------------------------------------------- | ------------------------ |
| The background service, launchers and downloaded versions       | `cmdeck uninstall`       |
| That, plus the desktop app, its `cmdeck`/`t3` commands and PATH | `cmdeck uninstall --app` |
| That, plus all CMDeck data (threads, settings, sign-ins)        | `cmdeck uninstall --all` |
| Nothing; lists what the command would remove                    | add `--dry-run`          |

Uninstall only removes CMDeck's own files: its data folder (`~/.cmdeck`, or `CMDECK_HOME`), its
app profile, service and commands. The official T3 Code (`~/.t3` and its app), your projects,
worktrees outside CMDeck's data folder, and your providers' settings such as `~/.claude` or
`~/.codex` are never touched. A data folder that might not be CMDeck's, such as one set only
through `T3CODE_HOME` or one outside your home folder, is kept and listed; delete it yourself if
it is.

On Linux, CMDeck does not remove the app itself: delete the AppImage, or run
`sudo apt remove cmdeck` if you installed the `.deb`.

## Next steps

- [User guide index](./README.md): overview of how CMDeck works.
- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): control when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Updating CMDeck](./updating.md): keep apps, servers, and providers up to date.
- [Import from T3 Code](./import-from-t3-code.md): bring threads and settings over from the official app.
