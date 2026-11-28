# Snapshots

A snapshot is a folder holding CMDeck's threads, projects, history, memory, bots, scheduled tasks
and settings. Use one to back CMDeck up, or to move it to another machine.

```sh
cmdeck export snapshot                      # writes snapshots/snapshot-<time> in CMDeck's data folder
cmdeck export snapshot --out ~/cmdeck-backup
```

Exporting is safe while CMDeck runs: it copies a consistent snapshot of the database. An agent in a
full-access thread can also make one for you with the `snapshot_export` tool; ask it for a backup.

## Restore

Quit CMDeck, including its background service, then:

```sh
cmdeck import snapshot --source ~/cmdeck-backup --plan   # see what would be restored; changes nothing
cmdeck import snapshot --source ~/cmdeck-backup
```

The import refuses while CMDeck is using the data folder. If CMDeck already has data, it stops;
`--force` moves the current `userdata` and `workflows` folders to `…backup-<time>` folders next to
them, then restores. Nothing is deleted. Use `--base-dir <folder>` to restore into a CMDeck folder
elsewhere.

A CMDeck build whose database schema is older than the snapshot's refuses it. Update CMDeck, then import.
An older snapshot is fine: CMDeck upgrades the copy the next time it starts.

Restoring is a command, not an agent tool, because it replaces the whole database and needs CMDeck
stopped.

## What a snapshot leaves out

Each snapshot's `README.md` and `manifest.json` list this too.

- **Secrets.** Provider and integration credentials, bot tokens and other secrets you entered stay
  on the machine. Enter them again after restoring. Webhook and workflow hook addresses change.
- **Sign-ins and devices.** Pair every browser, desktop app and phone again.
- **Worktrees and project folders.** Threads point at them where they were. On another machine,
  clone your projects to the same paths, or update each project's folder.
- **Provider-owned data,** such as Claude's and Codex's own session files and sign-ins.
- Attachments, browser captures, custom themes, workflow files, logs and caches.

Text that looks like a credential, such as an API key in a message, is replaced with `[redacted]`.
This is best effort: keep snapshots private.
