#!/usr/bin/env bash
# Fork invariants that an upstream merge can silently undo. Run after every upstream merge (and in CI).
# Usage: scripts/fork/guard.sh [upstream-ref]   (default: upstream/main when that ref exists)
set -uo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
REF="${1:-upstream/main}"
fail=0
bad() { echo "FAIL: $*" >&2; fail=1; }

# 1. The official T3 mobile app pairs only while the protocol version matches upstream.
if git rev-parse --verify -q "$REF" >/dev/null; then
  ours="$(grep -E '^export const ORCHESTRATION_PROTOCOL_VERSION' packages/contracts/src/environment.ts)"
  theirs="$(git show "$REF:packages/contracts/src/environment.ts" | grep -E '^export const ORCHESTRATION_PROTOCOL_VERSION')"
  [ "$ours" = "$theirs" ] || bad "protocol version differs from $REF: '$ours' vs '$theirs'"

  # 2. Fork tables live in ForkSchema.ts. A numbered fork migration would make the migrator skip upstream ones.
  extra="$(comm -23 \
    <(git ls-files apps/server/src/persistence/Migrations | sort) \
    <(git ls-tree -r --name-only "$REF" apps/server/src/persistence/Migrations | sort))"
  [ -z "$extra" ] || bad "fork-only numbered migrations (move them into ForkSchema.ts): $extra"
else
  echo "note: $REF not found; skipping upstream comparisons (git fetch upstream first)." >&2
fi

# 3. Code that must not come back. Docs and this guard are excluded.
forbidden=(
  'ingest\.t3\.codes'
  'posthog'
  'expo-observe'
  'v1internal'
  'antigravityUsageLimits'
  'relay\.t3\.codes'
  '@opentelemetry/exporter'
  'OTLPTraceExporter'
)
for pattern in "${forbidden[@]}"; do
  hits="$(git grep -n -i -E "$pattern" -- apps packages scripts ':!scripts/fork/**' ':!**/*.md' ':!apps/marketing/**' ':!**/*.graphql' | head -5)"
  [ -z "$hits" ] || bad "forbidden pattern '$pattern' is back:"$'\n'"$hits"
done

# 4. Installers must not carry a release feed (that would let the app replace itself with upstream).
if git grep -q -E 'resolveGitHubPublishConfig\(updateChannel\)' -- scripts/build-desktop-artifact.ts; then
  bad "scripts/build-desktop-artifact.ts publishes a GitHub update feed again"
fi

if [ "$fail" -ne 0 ]; then
  echo "Fork guard failed. See docs/operations/fork-upstream-sync.md." >&2
  exit 1
fi
echo "Fork guard passed."
