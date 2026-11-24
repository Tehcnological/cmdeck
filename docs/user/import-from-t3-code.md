# Import from T3 Code

CMDeck keeps its own data folder, separate from the official T3 Code. To bring your T3 Code
threads, projects, settings and provider sign-ins over, run the import once:

```sh
cmdeck import-from-t3 --dry-run   # see what would be copied; changes nothing
cmdeck import-from-t3             # import
```

`t3 import-from-t3` is the same command.

When CMDeck starts with no threads and finds a T3 Code data folder, the app offers the import once
with the exact command to run. Dismiss it and it does not come back.

## Before you start

- **Quit CMDeck**, including its background service. The import replaces CMDeck's database, so it
  refuses to run while CMDeck is using it.
- T3 Code can keep running. The import takes a consistent snapshot of its database and never
  writes to T3 Code's folder; changes made in T3 Code after the snapshot are not imported.
- If T3 Code's database is newer than your CMDeck build, the import refuses. Update CMDeck first. An
  older database is fine: CMDeck upgrades the copy the next time it starts.

By default the import reads `~/.t3` and writes to CMDeck's data folder. Use `--from <folder>` for a
T3 Code folder elsewhere and `--base-dir <folder>` for a CMDeck folder elsewhere.

If CMDeck already has data, the import stops. `--force` moves CMDeck's current `userdata` and
`workflows` folders to `…backup-<time>` folders next to them, then imports. Nothing is deleted.

## What is imported

- Threads, projects, history and scheduled tasks.
- Settings, provider instances, keybindings and themes.
- Stored credentials: provider API keys and environment variables, source control and issue tracker
  tokens, and other secrets you entered in settings.
- Provider sign-ins T3 Code keeps itself, such as extra Codex accounts and Antigravity profiles.
  Sign-ins kept by the provider CLIs in your home folder (for example `~/.codex` or `~/.claude`)
  are shared by both apps and need nothing.
- Thread attachments, browser captures and your workflow files.

## What is not imported

- **Paired devices and sign-in sessions.** CMDeck gets its own identity so both apps can run side by
  side without confusing your devices. Every browser, desktop app and phone must pair with CMDeck
  again. In the official T3 Code iPhone app, add CMDeck as a new environment with a fresh pairing
  link (`cmdeck pair`); its T3 Code environment keeps working as before.
- **Linked environments and guest links.** Link other environments to CMDeck again, and share new
  guest links.
- **Remote connections saved in the desktop app.** The desktop app encrypts them with a key tied to
  the app, so add them again in CMDeck.
- Worktrees stay where they are: imported threads keep using them from T3 Code's folder. Don't
  delete T3 Code's `worktrees` folder while CMDeck threads still use them.
- Logs, caches, downloaded speech models and tools, installed runtimes and the background service.
  CMDeck downloads or rebuilds them when needed.

If a provider shows as signed out after the import, sign in again from its settings.

The import does not change T3 Code's data. SQLite may leave empty helper files (`statev2.sqlite-wal`
and `-shm`) next to T3 Code's database; they hold no data and T3 Code uses them normally.
