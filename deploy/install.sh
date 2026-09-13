#!/usr/bin/env bash
# Install or refresh futarchy chess on its server (docs/chess.md, "Operation"). Run as telarchy: bash deploy/install.sh
# Idempotent. Expects ~/src/telarchy-chess to be this checkout with a filled .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "write .env first (see .env.example)"; exit 1; }
npm ci --silent
npm run build --silent
mkdir -p ~/.config/systemd/user ~/logs state
cp deploy/telarchy-chess.service deploy/telarchy-chess-stream.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now telarchy-chess.service
systemctl --user restart telarchy-chess.service
# The channel takes one stream (docs/chess.md, "The stream"): only with a key, and only once the snake's stream is off.
if grep -q '^TWITCH_STREAM_KEY=.\+' .env && ! systemctl --user is-active --quiet telarchy-snake-stream.service; then
  systemctl --user enable --now telarchy-chess-stream.service
  systemctl --user restart telarchy-chess-stream.service
else
  echo "stream unit not started (no TWITCH_STREAM_KEY in .env, or telarchy-snake-stream.service still running)"
fi
systemctl --user --no-pager --no-legend list-units 'telarchy-chess*'
