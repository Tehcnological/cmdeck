# Updating CMDeck

CMDeck clients and servers can run on different machines and must share a compatible orchestration protocol. When a server or provider is behind, the sidebar update button and **Settings → Environments** handle updates.

## Desktop app updates

The desktop app updates itself from CMDeck's releases on
[github.com/Tehcnological/cmdeck](https://github.com/Tehcnological/cmdeck/releases), never from
the official T3 Code. Releases are numbered v1, v2, v3, and **Settings → About** shows the version
you run. The app checks shortly after it starts and every few hours; when a release is out, the
update button offers it, and **Restart to update** installs it.

- **Windows** runs the new installer and reopens CMDeck. The builds are unsigned, so Windows may
  ask whether to run it.
- **Linux** replaces the AppImage in place. The `.deb` asks for your password to install the new
  package.
- **macOS** downloads the new app, checks it against the release, and swaps it in when CMDeck
  quits. CMDeck must be somewhere you can write to, such as Applications. If it cannot replace
  itself (for example when opened from the disk image), it says so; move it to Applications or
  install the new version from the release page.

To stop the automatic checks, turn off **Settings → About → Check for updates automatically**.
**Check for updates** still works, and the change applies without a restart. To turn updates off
entirely, start the app with `T3CODE_DISABLE_AUTO_UPDATE=1`, or use a
[managed policy](./managed-policy.md).

## Update everything at once

Click the **Update** button at the bottom of the sidebar (web or desktop) to update outdated providers, behind servers, and the desktop app in one step.

- Hover to preview what will update; click while running to view per-machine progress or retry failures.
- Confirmation dialogs show which machines are skipped (offline or manual-only) and how many active threads will pause/resume.
- Choose **Later** on the desktop restart countdown to restart when ready.

## Stable and Beta

The desktop app follows one of two update tracks:

- **Stable** installs releases v1, v2, v3. It never installs a beta.
- **Beta** installs betas, such as v3-beta.1, as soon as they are out, and every Stable release
  too, so after v3-beta.2 it moves on to v3 and then to v4-beta.1. Betas get less testing than
  Stable releases and can have bugs.

To switch, change **Settings → About → Update track**. Only this app switches; connected machines
keep the version they run. Moving to Beta offers the newest beta at the next check. Moving back to
Stable keeps the beta you run and installs the next Stable release that is newer, so CMDeck never
goes back to an older version. An app that was on the old Nightly track is on Beta.

## Continue threads after restarts

**Settings → Maintenance → Continue threads after restarts** is enabled by default. After an update, crash, or reboot (once CMDeck starts again), supported active threads automatically resume—and threads waiting on subagents or monitors are woken and notified that background work stopped.

- Threads waiting for your approval/answer/secret—or archived, snoozed, or settled—are not auto-resumed.
- After 3 consecutive crash recoveries of an unfinished turn, the thread waits for your next message.
- Updating from V1? Read [Threads from older CMDeck versions](./thread-migration.md).

## Update a connected server manually

| Situation                           | Action                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Background service / desktop server | Click **Update server** in **Settings → Environments** (desktop hosts relaunch automatically).        |
| Installed `t3` CLI                  | Run `t3 update <version>` on the host (then `t3 service restart` if you declined the restart prompt). |
| `npx` server                        | Stop the server and relaunch with `npx t3@<version>` and your usual flags.                            |

Each server checks npm/Homebrew/pnpm using its own local registry and proxy settings.

## Update providers

Open **Settings → Providers** and click **Update now** on individual providers or **Update all** across connected environments. Running chats keep using their current CLI until they end; new sessions and model catalogs refresh automatically. (Provider update checks in **Settings → Maintenance** must be enabled to fetch model catalog updates.)

## Mobile updates

- Update connected environments and providers from **Settings → Environments** on mobile.
- Update the mobile app via the App Store or Google Play (background over-the-air updates apply on next app switch and preserve drafts/queued messages).

## Troubleshooting

- **Version mismatch**: Update whichever side (app or server) the connection notice names.
- **Failed update**: Retry once; confirm you updated the host machine (not just the client) and that only one server owns the CMDeck data folder.
- **macOS Alpha → Beta**: Open `/Applications/CMDeck (Beta).app` manually and re-pin it to the Dock.
- **Desktop won't start**: Use the recovery window's **Update** button, install the linked last-working version, or **Copy details** for a bug report.
