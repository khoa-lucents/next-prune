#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="/tmp/next-prune-pilotty-fixture"
APP_DIR="$FIXTURE_ROOT/app"
SESSION="np-smoke"
DAEMON_LOG="$FIXTURE_ROOT/daemon.log"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd pilotty
require_cmd bun
require_cmd jq

cleanup() {
  set +e
  pilotty kill -s "$SESSION" >/dev/null 2>&1 || true
  pilotty stop >/dev/null 2>&1 || true
  if [ -n "${DAEMON_PID:-}" ]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

rm -rf "$FIXTURE_ROOT"
mkdir -p "$APP_DIR/out"
printf 'export' > "$APP_DIR/out/index.html"

pilotty stop >/dev/null 2>&1 || true
sleep 0.6
pilotty daemon >"$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
sleep 0.6
if ! kill -0 "$DAEMON_PID" >/dev/null 2>&1; then
  echo "pilotty daemon failed to stay running" >&2
  if [ -f "$DAEMON_LOG" ]; then
    sed -n '1,120p' "$DAEMON_LOG" >&2
  fi
  exit 1
fi

pilotty spawn --name "$SESSION" --cwd "$ROOT_DIR" bun run src/cli.ts --cwd "$APP_DIR" >/dev/null
pilotty wait-for -s "$SESSION" "Choose cleanup profile:" -t 15000 >/dev/null

hash="$(pilotty snapshot -s "$SESSION" | jq -r '.content_hash')"

# Keep default profile.
pilotty key -s "$SESSION" enter >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 120 > "$FIXTURE_ROOT/profile.json"

if ! jq -r '.text' "$FIXTURE_ROOT/profile.json" | grep -q 'Filter paths by substring (optional):'; then
  echo "Expected path filter prompt after profile selection" >&2
  exit 1
fi

# Keep empty path filter.
hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/profile.json")"
pilotty key -s "$SESSION" enter >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 120 > "$FIXTURE_ROOT/sort.json"

if ! jq -r '.text' "$FIXTURE_ROOT/sort.json" | grep -q 'Sort candidates by:'; then
  echo "Expected sort prompt after path filter" >&2
  exit 1
fi

# Keep default sort order.
hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/sort.json")"
pilotty key -s "$SESSION" enter >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 120 > "$FIXTURE_ROOT/multiselect.json"
if ! jq -r '.text' "$FIXTURE_ROOT/multiselect.json" | grep -q 'Select candidates to prune:'; then
  echo "Expected candidate multiselect prompt" >&2
  exit 1
fi
if ! jq -r '.text' "$FIXTURE_ROOT/multiselect.json" | grep -q 'out'; then
  echo "Expected out candidate in multiselect prompt" >&2
  exit 1
fi

# Select candidate and continue to confirmation prompt.
hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/multiselect.json")"
pilotty key -s "$SESSION" space >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 100 > "$FIXTURE_ROOT/multiselect-selected.json"
hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/multiselect-selected.json")"
pilotty key -s "$SESSION" enter >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 140 > "$FIXTURE_ROOT/confirm.json"
if ! jq -r '.text' "$FIXTURE_ROOT/confirm.json" | grep -Eq 'Delete [0-9]+ selected items'; then
  echo "Expected deletion confirmation prompt" >&2
  exit 1
fi

# Confirm deletion.
hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/confirm.json")"
pilotty key -s "$SESSION" y >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 220 > "$FIXTURE_ROOT/after-delete.json"
if ! jq -r '.text' "$FIXTURE_ROOT/after-delete.json" | grep -Eq 'Deleted [0-9]+/[0-9]+ items|Cleanup finished'; then
  echo "Expected deletion result output" >&2
  exit 1
fi

if [ -d "$APP_DIR/out" ]; then
  echo "Expected out/ directory to be deleted" >&2
  exit 1
fi

# Clack flow exits after completion.
sleep 1
if pilotty list-sessions | jq -e '.sessions[] | select(.name == "'"$SESSION"'")' >/dev/null; then
  echo "Expected pilotty session to exit after completion" >&2
  exit 1
fi

echo "pilotty smoke test passed"
