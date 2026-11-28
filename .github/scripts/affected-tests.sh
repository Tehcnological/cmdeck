#!/usr/bin/env bash
# Writes `args` to GITHUB_OUTPUT: the vitest arguments for this run's test jobs. On a pull request
# that is `--changed <base>`, so vitest runs only the test files whose import graph reaches a
# changed file. Empty means the full suite: pushes, manual runs, and pull requests that touch a
# path matching FULL_SUITE_PATHS (one regex per line, set by the workflow).
set -euo pipefail

full() {
  echo "Full suite: $*"
  echo "args=" >> "$GITHUB_OUTPUT"
  exit 0
}

[ "${GITHUB_EVENT_NAME:-}" = pull_request ] || full "${GITHUB_EVENT_NAME:-local} run"

# A pull request checks out GitHub's merge commit (fetch-depth: 2). Its first parent is the base
# branch, so the diff against it is the PR's change.
git rev-parse --verify -q HEAD^2 > /dev/null || full "HEAD is not a pull request merge commit"
base=$(git rev-parse HEAD^1)
changed=$(git diff --name-only --no-renames "$base" HEAD) || full "could not diff against $base"

patterns=$(sed '/^[[:space:]]*$/d' <<< "${FULL_SUITE_PATHS:?}")
hits=$(grep -E -f <(printf '%s\n' "$patterns") <<< "$changed" || true)
[ -z "$hits" ] || full "the change touches $(head -5 <<< "$hits" | paste -sd ' ')"

echo "Affected tests only: $(wc -l <<< "$changed") changed files since $base"
echo "args=--changed $base" >> "$GITHUB_OUTPUT"
