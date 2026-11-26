#!/usr/bin/env bash
# Merge upstream T3 Code into a review branch of this private fork.
# Never pushes, never touches main, never builds or installs anything.
# Usage: scripts/fork/sync-upstream.sh [upstream-ref]            (default: upstream/main)
#        scripts/fork/sync-upstream.sh --verify [upstream-ref]   (after resolving conflicts by hand)
set -euo pipefail
# Braces make bash parse the whole script first: `git switch` below may rewrite this file mid-run.
{

UPSTREAM_URL="https://github.com/pingdotgg/t3code.git"
VERIFY_ONLY=0
if [ "${1:-}" = "--verify" ]; then
  VERIFY_ONLY=1
  shift
fi
REF="${1:-upstream/main}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

# The guard cannot see a clean merge that imports a module the fork deleted; only a typecheck can.
verify() {
  scripts/fork/guard.sh "$REF"
  if ! vp run typecheck; then
    echo >&2
    echo "Typecheck failed on the merged tree. Fix it, commit, then: scripts/fork/sync-upstream.sh --verify $REF" >&2
    exit 3
  fi
}

# A package.json whose only conflict is the version line: keep the fork's version, take upstream's other edits.
resolve_version_only() {
  local f="$1" tmp version
  tmp="$(mktemp -d)"
  version="$(git show ":2:$f" | grep -m1 -E '^  "version": ')" || return 1
  git show ":1:$f" >"$tmp/base" 2>/dev/null || return 1
  git show ":2:$f" >"$tmp/ours"
  git show ":3:$f" >"$tmp/theirs"
  for side in base theirs; do
    awk -v v="$version" '!done && /^  "version": /{print v; done=1; next} {print}' "$tmp/$side" >"$tmp/$side.n"
    mv "$tmp/$side.n" "$tmp/$side"
  done
  git merge-file -q "$tmp/ours" "$tmp/base" "$tmp/theirs" || return 1
  cp "$tmp/ours" "$f"
  git add -- "$f"
}

if [ "$VERIFY_ONLY" = 1 ]; then
  verify
  echo "Fork guard and typecheck passed."
  exit 0
fi

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
  # Mechanical classes first: files the fork deleted stay deleted; version-only package.json conflicts keep ours.
  git status --porcelain | awk '$1 == "DU" { print $2 }' | while IFS= read -r f; do
    git rm -q -- "$f"
    echo "kept deleted (fork removed it): $f"
  done
  git diff --name-only --diff-filter=U | { grep -E '(^|/)package\.json$' || true; } | while IFS= read -r f; do
    if resolve_version_only "$f"; then echo "kept fork version: $f"; fi
  done

  if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
    echo
    echo "Conflicts to resolve:" >&2
    git diff --name-only --diff-filter=U >&2
    cat >&2 <<MSG

Resolve them (see docs/operations/fork-upstream-sync.md for the usual ones), then:
  git add -A && git commit --no-edit
  scripts/fork/sync-upstream.sh --verify $REF
MSG
    exit 2
  fi
  git commit -q --no-edit
fi

verify
cat <<MSG

Merged, and the fork guard and typecheck passed.
Next: git push -u origin $branch, then open a pull request into main and review it.
MSG
exit 0
}
