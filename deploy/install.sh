#!/usr/bin/env bash
# Install or refresh futarchy chess on its server (docs/chess.md, "Operation"). Run as telarchy: bash deploy/install.sh
# Idempotent. Expects ~/src/telarchy-chess to be this checkout with a filled .env.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "write .env first (see .env.example)"; exit 1; }
npm ci --silent
npm run build --silent
mkdir -p ~/.config/systemd/user ~/logs state
cp deploy/telarchy-chess.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now telarchy-chess.service
systemctl --user restart telarchy-chess.service
systemctl --user --no-pager --no-legend list-units 'telarchy-chess*'
