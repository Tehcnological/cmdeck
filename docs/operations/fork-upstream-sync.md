# Merging upstream into this private fork

This fork tracks [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Nothing updates on its
own: installers carry no release feed, servers do not fetch releases, and no workflow pulls
upstream. You merge upstream when you choose, review it as a pull request, then rebuild.

## Steps

```sh
scripts/fork/sync-upstream.sh            # or: scripts/fork/sync-upstream.sh <upstream-sha-or-tag>
```

The script:

1. Refuses to run on a dirty tree.
2. Adds the `upstream` remote if missing and makes it fetch-only (push URL `DISABLED`).
3. Creates `upstream-sync/<date>-<sha>` from `origin/main` and merges upstream into it.
4. Runs `scripts/fork/guard.sh`.

It never pushes, never touches `main`, and never builds or installs. When it finishes:

```sh
git push -u origin upstream-sync/<...>
gh pr create --base main --fill
```

Review the PR (the diff from upstream is the part to read), let CI pass, then merge.

## When the merge conflicts

The script stops and lists the files. Resolve, `git add -A && git commit --no-edit`, then run
`scripts/fork/guard.sh` yourself. The usual conflicts:

- **Telemetry, Antigravity quota probing, T3 Connect/relay.** The fork deleted these. If upstream
  edited a deleted file, keep it deleted (`git rm <file>`). If upstream added a new call site, remove
  it. The guard's forbidden-pattern list catches the common ones.
- **Migrations.** Always take upstream's `apps/server/src/persistence/Migrations.ts` and
  `Migrations/` exactly. Fork-only tables live in `apps/server/src/persistence/ForkSchema.ts`
  (idempotent `CREATE ... IF NOT EXISTS`), never in a numbered migration: the migrator skips every
  id at or below the highest one recorded, so a fork id would make later upstream migrations
  silently never run.
- **Protocol version.** Always take upstream's `ORCHESTRATION_PROTOCOL_VERSION`. The official T3
  mobile app pairs only when it matches.
- **Settings defaults.** Keep the fork's defaults (device approval on, remote MCP off) when upstream
  touches the same lines.

## What the guard checks

`scripts/fork/guard.sh [upstream-ref]` fails when:

- `ORCHESTRATION_PROTOCOL_VERSION` differs from upstream's;
- a numbered migration exists that upstream does not have;
- a forbidden pattern (analytics ingest, PostHog, crash reporting, OTLP exporters, Google
  `v1internal`, the T3 relay host) reappears in `apps/`, `packages/` or `scripts/`;
- the desktop build would publish a release feed again;
- a shared-data safeguard (below) lost its hook in an upstream file.

Add a pattern to its list whenever you remove something upstream may reintroduce.

## Shared data with the official T3 Code

The fork deliberately keeps upstream's data directory (`~/.t3`, or `T3CODE_HOME`), app ID, service
label and version numbers, so threads, settings, pairings and the official mobile app carry over
unchanged. Run only one of them per machine: quit and uninstall the official desktop app and its
background service before starting the fork.

What the fork enforces or reports. Alerts are logged and shown in the web and desktop app as a
warning toast (`fork.shared-data` server config issues, which the official clients ignore):

- **Desktop apps.** The shared app ID makes the fork's installer replace the official app, and the
  single-instance lock (keyed on the shared user-data folder) lets only one of them run. A running
  background service of either build owns `~/.t3`; the desktop app then says so and quits.
- **Database newer than the fork.** If the official app migrated the database further than this
  build knows, the fork still starts (so you can sync from inside it) and alerts until you run
  `scripts/fork/sync-upstream.sh` and rebuild. Upgrade-time preflight (`t3 update`, server
  self-update) still refuses to switch to a build older than the database.
- **Runtimes.** Every runtime the fork stages in `runtime/versions/<version>` (installs, updates,
  `scripts/install.sh`/`.ps1`, the desktop's SSH bootstrap) gets a `.t3code-fork` marker. Installs and
  updates refuse to reuse a complete runtime without it and name the folder to delete. A background
  service already running an unmarked runtime keeps running; the launcher logs it and the server
  alerts. Runtimes the fork installed before the marker existed trigger the same alert; if you are
  sure one is the fork's, create an empty `.t3code-fork` file in it.
- **Settings.** Every settings write mirrors the fork-only keys (`inferenceServers`,
  `textGenerationFallback`, `textGenerationModelSelectionExplicit`, provider instances' `inference`
  and `inferenceServerId`) to `fork-settings-backup.json` next to `settings.json`, without inline
  credentials (stored API keys stay in the secret store). When `settings.json` lacks a key the backup
  has, the fork restores it, rewrites the file and alerts. Add new fork-only settings keys to
  `apps/server/src/fork/forkSettingsBackup.ts`.

Only documented: the fork's `inference_requests` table and other fork-only state are invisible to
the official app, and nothing stops the official app from running against `~/.t3` while the fork is
stopped.
Second-model reviews are ordinary side chats tagged `second-model-review`, so the official clients
show them as plain side chats; the last reviewer choice is a client setting they may drop.
Close to tray and launch at login are fork-only desktop settings. The official desktop app drops
them the next time it saves its desktop settings, and it leaves an existing login item in place.
