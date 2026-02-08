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
mkdir -p "$APP_DIR/.next/cache" "$APP_DIR/out" "$APP_DIR/.turbo/cache"
printf 'cache' > "$APP_DIR/.next/cache/a.txt"
printf 'export' > "$APP_DIR/out/index.html"
printf 'turbo' > "$APP_DIR/.turbo/cache/t.bin"

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
pilotty wait-for -s "$SESSION" "Prune" -t 15000 >/dev/null

hash="$(pilotty snapshot -s "$SESSION" | jq -r '.content_hash')"

# Sort cycling (assert screen updates and app remains active)
for step in 1 2 3; do
  pilotty key -s "$SESSION" s >/dev/null
  pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 100 > "$FIXTURE_ROOT/sort-${step}.json"
  if ! jq -r '.text' "$FIXTURE_ROOT/sort-${step}.json" | grep -q 'Prune'; then
    echo "Expected app to remain visible after sort step $step" >&2
    exit 1
  fi
  hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/sort-${step}.json")"
done

# Open confirm modal then cancel
pilotty key -s "$SESSION" D >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 100 > "$FIXTURE_ROOT/confirm-open.json"
if ! jq -r '.text' "$FIXTURE_ROOT/confirm-open.json" | grep -Eq 'Delete [0-9]+ items\?'; then
  echo "Expected confirm modal to open" >&2
  exit 1
fi

hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/confirm-open.json")"
pilotty key -s "$SESSION" N >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 100 > "$FIXTURE_ROOT/confirm-cancelled.json"
if jq -r '.text' "$FIXTURE_ROOT/confirm-cancelled.json" | grep -Eq 'Delete [0-9]+ items\?'; then
  echo "Expected confirm modal to close after cancel" >&2
  exit 1
fi

hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/confirm-cancelled.json")"

# Open confirm modal and delete
pilotty key -s "$SESSION" D >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 100 > "$FIXTURE_ROOT/confirm-open-2.json"

hash="$(jq -r '.content_hash' "$FIXTURE_ROOT/confirm-open-2.json")"
pilotty key -s "$SESSION" Y >/dev/null
pilotty snapshot -s "$SESSION" --await-change "$hash" --settle 150 > "$FIXTURE_ROOT/after-delete.json"
if ! jq -r '.text' "$FIXTURE_ROOT/after-delete.json" | grep -Eq 'Deleted.*items'; then
  echo "Expected deletion status after confirm" >&2
  exit 1
fi

if [ -d "$APP_DIR/out" ]; then
  echo "Expected out/ directory to be deleted" >&2
  exit 1
fi

# Graceful quit
pilotty key -s "$SESSION" Q >/dev/null
sleep 1
if pilotty list-sessions | jq -e '.sessions[] | select(.name == "'"$SESSION"'")' >/dev/null; then
  echo "Expected pilotty session to exit after Q" >&2
  exit 1
fi

echo "pilotty smoke test passed"
