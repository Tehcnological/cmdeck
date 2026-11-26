# Install CMDeck

CMDeck runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

> [!NOTE]
> CMDeck is an unofficial fork of T3 Code. Its desktop app is on
> [CMDeck's GitHub releases](https://github.com/Tehcnological/cmdeck/releases). The `t3.codes`
> installers, `npx t3`, the `t3` npm package, and T3 Code's GitHub releases and package-manager
> entries all install the official T3 Code, not CMDeck. For the command line, install CMDeck from
> builds you host yourself, as described below. The installer adds both a `cmdeck` and a `t3`
> command. CMDeck keeps its data in `~/.cmdeck` (set `CMDECK_HOME` to move
> it) and its server defaults to port 3783, so it can run next to the official T3 Code.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch CMDeck and configure providers afterwards.

## Command line

The installers in `scripts/` download a CMDeck build from your own mirror: any HTTP(S) server
laid out as `<mirror>/v<version>/SHA256SUMS` next to `t3-<version>-<platform>-<arch>.tar.gz`
(`.zip` on Windows). Set `T3CODE_RELEASE_BASE_URL` to the mirror and `T3CODE_VERSION` to the
version to install; without them the installer stops instead of downloading anything.

```bash
T3CODE_RELEASE_BASE_URL=https://mirror.example/cmdeck T3CODE_VERSION=1.2.3 scripts/install.sh
```

On Windows, in PowerShell:

```powershell
$env:T3CODE_RELEASE_BASE_URL = "https://mirror.example/cmdeck"
$env:T3CODE_VERSION = "1.2.3"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The installer checks the archive against `SHA256SUMS` and installs the `t3` and `cmdeck`
commands to `~/.local/bin`. If that folder is not on your
`PATH` yet, the installer says so and, for zsh, bash on Linux, and fish, prints
a command to add it. On Windows, `t3` works in the same PowerShell window right
away; add the folder to your `PATH` for new windows. If a `t3` that the
installer or the desktop app did not create is already there, it leaves that
one alone and stops.

| Task                                  | Command                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Start the server and open the web app | `t3`                                                                    |
| Start the server without a browser    | `t3 serve`                                                              |
| Use it from your other devices        | `t3 up` ([details](./remote-access.md))                                 |
| Keep it running in the background     | `t3 service install` ([details](./background-service.md))               |
| Move to the newest release            | `t3 update`                                                             |
| Reclaim database space                | `t3 doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                       | `t3 uninstall` ([details](#uninstall-cmdeck))                           |

Run `t3 help` or `t3 --help` for the full reference. To start in a new working
directory, use an explicit path such as `t3 ./my-project`. A bare directory name
is accepted only if it already exists.

If `t3` or `t3 start` reports an already running server, run the `t3 pair`
command it names and open the pairing URL to connect to that server. Stop it
before starting a replacement, or use a different `--base-dir` for an
independent server.

### Intel Macs

There is no `t3` executable for Intel Macs. To
run a server there, build it from source with `vp`, which provides the Node version it needs
([Install vp](../operations/00_development.md#first-checkout)):

```bash
git clone https://github.com/Tehcnological/cmdeck
cd cmdeck && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`t3 update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

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

### The `cmdeck` command

The desktop app includes the command-line tool as `cmdeck`, with `t3` as a second name. A new
install sets it up on first launch; after an update, or any time, choose
**Install** next to **cmdeck command** in **Settings → About**. On macOS and Linux
it adds a `cmdeck` link in `~/.local/bin` (or `~/bin`), and a `t3` link beside it
when no other `t3` is there; on Windows it adds the app's command folder, which
holds both, to your `PATH`. Open a new terminal afterwards. If the folder is not
on your `PATH`, **Add to PATH** on the Welcome page or in **Settings → About**
adds one line to your shell's startup file. **Remove** takes them off, and the
app does not add them again. Another `t3`, such as the official T3 Code's, stays
as it is; use `cmdeck` for CMDeck.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. CMDeck installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
t3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `t3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

### Drop a folder on the sidebar

Drag one or more folders from Finder, Explorer, or your file manager onto the
sidebar. Each one opens as a project on this computer, the same as `t3 app`.
Files dropped on a thread still attach to that thread. Browsers do not share
folder paths, so in the web app use **Add project** instead.

## Mobile app

Install CMDeck from the
[App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

Store links and QR codes are also available in **Settings → About → Mobile app**
on web and desktop. The store apps work with both stable and Nightly servers. Test builds are optional:

- **iPhone and iPad:** TestFlight is invite-only.
- **Android:** download an APK from the
  [Android beta releases](https://github.com/pingdotgg/t3code/releases?q=android-beta-).

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider            | Install and authenticate                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex               | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude              | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor              | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build          | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro                | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode            | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity         | Install and sign in with Google from CMDeck's provider settings.                                                                                          |
| Pi                  | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code           | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx                  | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |
| ACP Registry agents | Add GitHub Copilot and other [ACP agents](./providers-acp.md#add-an-agent) from **Settings → Providers → Add provider → Show more**.                      |

Provider CLIs must be on the server's `PATH`. If CMDeck cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

CMDeck warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, mise, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or
the CLI's own update command when CMDeck cannot tell. Claude, Codex, and
OpenCode installs CMDeck cannot identify stay manual: update them through the
installer you used. CMDeck runs `mise upgrade`
only for a tool your mise config requests as `latest` when the provider's binary
path is a mise shim or under the tool's `installs/<tool>/latest` link; update a
pinned version, or a path into one version's directory, through mise yourself.
Update a CLI installed with Nix through Nix.
Cursor and Antigravity update with CMDeck. Homebrew and Chocolatey installs
compare against the version their package manager offers, which can trail the
npm release; update Claude installed with Chocolatey through Chocolatey.

The managed runtimes for Antigravity and for Codex connected through ChatGPT
first install the release CMDeck tested. When CMDeck finds a newer compatible
release, their setup in **Settings → Providers** offers an update.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, CMDeck does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md),
[Pi](./providers-pi.md), [Muse Code](./providers-muse.md), [fx](./providers-fx.md), and
[ACP Registry agents](./providers-acp.md).

### Provider check timeouts

If a provider works in its CLI but CMDeck reports a timeout while checking it,
allow more time in the T3 server's environment. For example, give Codex and
Claude readiness checks 60 seconds:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 t3 serve
```

For a remote environment, set these on the machine running the T3 server.
Keep them in your launcher or service configuration to retain them across
updates, then restart the server. For systemd, add
`Environment=T3CODE_CODEX_PROBE_TIMEOUT_MS=60000` under `[Service]` in a service
override, reload systemd, and restart the service. Provider instances can also
set their own overrides in Settings → Providers.

Each variable extends that provider's readiness-probe deadlines; a phase whose
default is already longer keeps its default. Providers with several phases can
take longer than one deadline in total. Values must be whole milliseconds no
greater than 2147483647; unset or invalid values keep the defaults.

| Provider            | Environment variable                   |
| ------------------- | -------------------------------------- |
| Codex               | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude              | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor              | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity         | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok                | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro                | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx                  | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi                  | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code           | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode            | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry agents | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

Longer deadlines also take longer to report a stalled check. These overrides
cover readiness and discovery, including OpenCode server startup. Usage and
config enrichment retain their own shorter limits. Turn execution, package
installation, update checks, and shutdown limits keep their existing behavior.

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

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a host available.
- [Updating CMDeck](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure CMDeck for everyone on a machine.
