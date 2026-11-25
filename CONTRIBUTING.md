# Contributing

CMDeck is a personal, unofficial fork of [T3 Code](https://github.com/pingdotgg/t3code) with one
maintainer. It is public so its code can be read and checked. Issues are welcome; pull requests
may be closed without review.

## Where things go

- **A bug in code inherited unchanged from T3 Code:** report or fix it upstream, following
  [upstream's contributing guide](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md).
  CMDeck picks up the fix with its next upstream merge.
- **A bug in what CMDeck changed or added** (see [what this fork adds](README.md) and
  [what it renamed](docs/operations/fork-upstream-sync.md#renamed-in-this-fork)): a focused pull
  request here is welcome. You can also open an issue.
- **A security problem:** follow the [security policy](.github/SECURITY.md). Do not open a public
  pull request for it.
- **A feature request:** open an issue that describes what you want and why. A feature pull
  request without an issue the maintainer agreed to may be closed.

Do not report CMDeck bugs to T3 Tools. They do not maintain this fork.

<a id="one-problem"></a>

## Rules for a pull request

- Fix one problem, and include every change it needs across contracts, server, clients, tests, and
  docs.
- Say how you found the problem, how you checked the fix, and what you saw. UI changes need before
  and after screenshots, uploaded to the PR, never committed.
- Keep the fork compatible with T3 Code: do not change the orchestration protocol version, wire,
  RPC or schema names, pairing and auth formats, or mDNS names. `scripts/fork/guard.sh` checks
  several of these, and the PR's CI runs it.
- Keep upstream's wording in text the AI agents read (prompts, MCP tool descriptions, the MCP
  server name). See "Renamed in this fork" in
  [fork-upstream-sync.md](docs/operations/fork-upstream-sync.md).
- Nothing may send data out of the machine: no telemetry, analytics, crash reporting, or hosted
  relay.
- Use a conventional commit title in plain language, such as `fix(web): new threads no longer spike
  CPU`.

## Setup and CI

See the [development runbook](docs/operations/00_development.md#first-checkout). CI runs the fork
guard, typecheck, lint, and all test suites on every pull request. A maintainer can add the
`run-fixups` label to regenerate translation catalogs, formatting, and placeholder icons as a patch.

## Trademarks

See [TRADEMARK.md](./TRADEMARK.md).
