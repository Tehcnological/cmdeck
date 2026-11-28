# Merging upstream into this fork

This fork tracks [pingdotgg/t3code](https://github.com/pingdotgg/t3code). Upstream never arrives on
its own: desktop installers update only from this repository's own releases
([release runbook](./03_release.md#cmdeck-releases-this-fork)), servers do not fetch releases, and
no workflow pulls upstream. You merge upstream when you choose, review it as a pull request, then
release.

## Steps

```sh
scripts/fork/sync-upstream.sh            # or: scripts/fork/sync-upstream.sh <upstream-sha-or-tag>
```

The script:

1. Refuses to run on a dirty tree.
2. Adds the `upstream` remote if missing and makes it fetch-only (push URL `DISABLED`).
3. Creates `upstream-sync/<date>-<sha>` from `origin/main` and merges upstream into it.
4. Resolves the mechanical conflicts: a file the fork deleted stays deleted, and a `package.json`
   whose only conflict is its `version` line keeps the fork's version.
5. Runs `scripts/fork/guard.sh` and `vp run typecheck`. The typecheck matters: upstream code can merge
   cleanly and still import a module the fork deleted, which the guard cannot see.

It never pushes, never touches `main`, and never builds or installs. When it finishes:

```sh
git push -u origin upstream-sync/<...>
gh pr create --base main --fill
```

Review the PR (the diff from upstream is the part to read), let CI pass, then merge.

## When the merge conflicts

The script stops and lists the files it could not resolve. Resolve them, `git add -A && git commit
--no-edit`, then run `scripts/fork/sync-upstream.sh --verify <upstream-ref>` (guard plus typecheck). The
usual conflicts:

- **Telemetry, Antigravity quota probing, T3 Connect/relay.** The fork deleted these. If upstream
  edited a deleted file, keep it deleted (`git rm <file>`). If upstream added a new call site, remove
  it. The guard's forbidden-pattern list catches the common ones.
- **Migrations.** Take upstream's numbered files in `apps/server/src/persistence/Migrations/` exactly,
  and upstream's changes to `Migrations.ts`, but keep the fork's `ensureForkSchema` import and its call
  at the end of the migrator (the guard checks both). Fork-only tables live in
  `apps/server/src/persistence/ForkSchema.ts` (idempotent `CREATE ... IF NOT EXISTS`), never in a
  numbered migration: the migrator skips every id at or below the highest one recorded, so a fork id
  would make later upstream migrations silently never run.
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
- the desktop build's release feed points anywhere but `Tehcnological/cmdeck`;
- a fork hook or CMDeck identity value (below) lost its place in an upstream file.

Add a pattern to its list whenever you remove something upstream may reintroduce.

## Where fork code goes

Fork features attach to upstream through a few seams, each one line in an upstream file and listed in
the guard. Adding a feature should not need another edit to a busy upstream file:

- **Services:** `apps/server/src/fork/<module>/`, provided from `apps/server/src/fork/ForkLayer.ts`.
- **Tables:** the module's own idempotent `ensure*Schema()`, called from
  `apps/server/src/persistence/ForkSchema.ts`.
- **RPCs:** methods named `cmdeck.*` in `packages/contracts/src/fork/rpc.ts` (`ForkWsRpcGroup`, merged
  into `WsRpcGroup`), each with a scope in `FORK_RPC_SCOPES`, which the server authorizes like any other
  method. Handlers go in `apps/server/src/fork/rpc/ForkRpcHandlers.ts`.
- **Settings:** fields of `CmdeckSettings` (`packages/contracts/src/fork/settings.ts`), stored under one
  `cmdeck` key that upstream clients, including the official mobile app, ignore. A missing field means
  the module is off.
- **MCP tools:** `apps/server/src/fork/mcpToolkits.ts`.
- **Services orchestration reads:** `ForkLayer.layerBeneathOrchestration`, provided beneath
  orchestration in `server.ts`, so it may depend only on settings, persistence and the project store.
- **Turn context:** contributors in `apps/server/src/fork/memory/TurnContext.ts` add one fenced block to
  the provider prompt at turn start (`ProviderTurnStartService.ts`). The stored message never holds it,
  so events and the official mobile app are unchanged.
- **Command palette:** `apps/web/src/fork/commands.ts`.
- **Right panel:** one `cmdeck` surface kind whose tabs come from `apps/web/src/fork/panels.tsx`. A module
  adds a tab there, not another surface kind.
- **Secret store:** a file that builds `ServerSecretStore.layer` imports `ServerSecretStore` from
  `apps/server/src/fork/secrets/EncryptedSecretStore.ts`, which re-exports the upstream module with an
  encrypting `layer`. A builder that keeps the upstream import would read encrypted files as raw
  bytes, so the guard fails on it; after a merge, point its import at the fork module.
- **Right panel tabs:** a panel id in `apps/web/src/fork/panelSurface.ts` and its title, icon and
  content in `apps/web/src/fork/panels.tsx`. Every fork panel is one `cmdeck` surface kind, so a new
  panel needs no edit to `rightPanelStore.ts` or the tab components.

Fork RPCs and settings are additive and never change `ORCHESTRATION_PROTOCOL_VERSION`. An optional
module does nothing while it is off (no fibre, timer, subscription or request) and adds a case to
`apps/server/src/fork/privacy/egress.test.ts` proving it.

## Separate data from T3 Code

CMDeck keeps its own data and identity, so it installs and runs next to the official T3 Code
without either one touching the other's state:

| What                   | CMDeck                                                                              | Official T3 Code                                           |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Data directory         | `~/.cmdeck` (`CMDECK_HOME`, else `T3CODE_HOME` unless it is `~/.t3`)                | `~/.t3` (`T3CODE_HOME`)                                    |
| Desktop app ID         | `com.tehcnological.cmdeck`                                                          | `com.t3tools.t3code`                                       |
| Electron profile       | `<app data>/cmdeck` (dev: `cmdeck-dev`)                                             | `<app data>/t3code-v2`                                     |
| Windows install folder | `%LOCALAPPDATA%\Programs\cmdeck`                                                    | `%LOCALAPPDATA%\Programs\t3code`                           |
| Background service     | `cmdeck.service`, `com.tehcnological.cmdeck.service`, task `cmdeck-<domain>-<user>` | `t3code.service`, `com.t3tools.t3code.service`, `t3code-…` |
| Default server port    | 3783                                                                                | 3773                                                       |

All of these come from `packages/shared/src/appIdentity.ts`, which also exports upstream's values
for the importer. CMDeck never reads the official app's folders on its own: the upstream code that
copied the old Windows `Local State` and imported V1 `localStorage` is disabled. To bring threads
and settings over, run `cmdeck import-from-t3`.

`cmdeck import-from-t3` ([user guide](../user/import-from-t3-code.md)) copies an official T3 Code
data folder into CMDeck's own. It refuses a source database newer than this build, so sync
upstream before importing from a newer official release. When upstream adds identity-bound state
(signing keys, sessions, device or peer tables), add it to the exclusions in
`apps/server/src/fork/T3Import.ts`.

Still enforced or reported. Alerts are logged and shown in the web and desktop app as a warning
toast (`fork.shared-data` server config issues, which the official clients ignore):

- **Database newer than CMDeck.** An imported database (or one under a shared `CMDECK_HOME`) that a
  newer T3 Code migrated still starts, and alerts until you run `scripts/fork/sync-upstream.sh` and
  rebuild. Upgrade-time preflight still refuses to switch to a build older than the database.
- **Runtimes.** Every runtime CMDeck stages in `runtime/versions/<version>` (installs, updates,
  `scripts/install.sh`/`.ps1`, the desktop's SSH bootstrap) gets a `.cmdeck` marker. Installs and
  updates refuse to reuse a complete runtime without it, and the server alerts when the background
  service runs one.

Deep links stay on `t3code://` (and `t3code-dev://`). Both apps register that scheme, so the OS
sends a link to whichever registered last; a separate `cmdeck://` scheme is not wired up.

Compatibility with the official mobile app and other T3 Code servers is unchanged: protocol
versions, RPC and schema names, pairing and auth token formats, `/.well-known/t3/...` paths,
mDNS service names and HTTP headers are upstream's. Second-model reviews are ordinary side chats
tagged `second-model-review`, so the official clients show them as plain side chats; the last
reviewer choice is a client setting they may drop.

## Renamed in this fork

**Renamed to CMDeck:** every user-visible "T3 Code" in apps (web, desktop, mobile, server CLI and
errors), packages, scripts, `docs/user/`, `docs/README.md` and the README; window titles, menus,
About, PWA manifest and `<title>`, installer product name (`CMDeck`, nightly `CMDeck (Nightly)`),
artifact names (`CMDeck-<version>-<arch>.<ext>`), Linux executable `cmdeck` and desktop entry
`com.tehcnological.CMDeck`, the CLI's help name (`cmdeck`, with a `cmdeck` bin beside `t3`), the
translation catalogs (re-keyed, see below), and the identity values in the table above.
Release builds show the plain name; Dev and Nightly keep their stage suffix.

**Deliberately kept:**

- Internal names: the `t3` package and CLI (still works), `@t3tools/*` imports, `T3CODE_*`
  environment variables, `t3code://` deep links, `t3.json` project files. User-visible text calls
  the data folder (`~/.cmdeck` or `CMDECK_HOME`) the "CMDeck data folder" instead of upstream's
  "T3 home", and "T3 tools" are "CMDeck tools"; code comments, test names and identifiers keep
  "T3 home".
- Wire and compatibility identifiers listed above.
- Model-facing text: agent system prompts and runtime notes (`packages/provider-core`), MCP tool
  descriptions and the MCP server name, agent-to-agent message prefixes (`[T3 Code: …]` in
  `packages/contracts/src/orchestrationV2.ts`), title prompts, and replay-fixture git identities.
  Recorded provider replays and evals match this text exactly, and keeping it as upstream keeps
  merges clean. The model may therefore call the app "T3 Code".
- Provider-facing identities: Codex `clientInfo`/originator and ChatGPT `agent_name_hint`,
  Antigravity and Muse `clientInfo`, recorded provider transcripts (`*.ndjson`), and the git
  identity of hidden checkpoint commits. Providers may key behavior on these.
- Mentions of the official product: the official mobile app and its store listings, "official
  T3 Code" in fork code, T3 Connect and T3 Chat (upstream services), `TRADEMARK.md`,
  `AGENTS.md`, `docs/internals/`, `docs/operations/`, `apps/marketing/`, `evals/`, and the
  managed-policy domain `com.t3tools.t3code` (MDM profiles target the official app ID).
- Mobile bundle IDs and the fork's own mobile modules (CMDeck ships no mobile app; use the official
  one).
- Linux capture-helper names (`com.t3tools.T3Code.SnapShot`, `…KdeCapture`).

**Translations.** GT keys are the first 16 hex characters of the SHA-256 of the stable JSON
`{"dataFormat":"ICU"|"JSX","source":…}` (plus `context` when set; JSX drops `i` and `t`). The
rename changed the English source strings, so each affected key was recomputed and moved in every
locale, with "T3 Code" replaced by "CMDeck" in the translations. `vp run i18n:check` should pass;
`vp run i18n:generate` rewrites the same keys.

**Merge conflicts on rebranded strings.** Take upstream's version of the line, then reapply the
rename: replace "T3 Code" with "CMDeck" unless it is one of the kept cases above. For translated
strings, run `vp run i18n:generate` in the app afterwards; it moves upstream's new English to the
new key, and you replace the product name in each locale's value. `scripts/fork/guard.sh` checks
that `appIdentity.ts` and its hooks survived the merge. To find leftovers:
`git grep -n "T3 Code" -- apps packages docs/user ':!apps/marketing'`.
