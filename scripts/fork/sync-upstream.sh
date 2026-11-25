#!/usr/bin/env bash
# Merge upstream T3 Code into a review branch of this private fork.
# Never pushes, never touches main, never builds or installs anything.
# Usage: scripts/fork/sync-upstream.sh [upstream-ref]   (default: upstream/main)
set -euo pipefail

UPSTREAM_URL="https://github.com/pingdotgg/t3code.git"
REF="${1:-upstream/main}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
# Read-only remote: a stray `git push upstream` fails instead of reaching pingdotgg.
git remote set-url --push upstream DISABLED

git fetch --no-tags upstream
git fetch --no-tags origin main

ahead="$(git rev-list --count origin/main.."$REF")"
if [ "$ahead" = "0" ]; then
  echo "Already up to date with $REF."
  exit 0
fi

branch="upstream-sync/$(date +%Y-%m-%d)-$(git rev-parse --short "$REF")"
git switch -c "$branch" origin/main
echo "Merging $ahead upstream commits from $REF into $branch ..."

if ! git merge --no-ff --no-edit -m "merge: upstream $(git rev-parse --short "$REF") into fork" "$REF"; then
  echo
  echo "Conflicts to resolve:" >&2
  git diff --name-only --diff-filter=U >&2
  cat >&2 <<'MSG'

Resolve them (see docs/operations/fork-upstream-sync.md for the usual ones), then:
  git add -A && git commit --no-edit
  scripts/fork/guard.sh
MSG
  exit 2
fi

scripts/fork/guard.sh
cat <<MSG

Merged cleanly and the fork guard passed.
Next: git push -u origin $branch, then open a pull request into main and review it.
MSG
