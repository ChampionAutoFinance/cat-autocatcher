#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="${1:-about:blank}"
FIREFOX="${FIREFOX_EXE:-/Applications/Firefox.app/Contents/MacOS/firefox}"
PROFILE_DIR="$APP_DIR/.firefox-cat-autocatcher-profile"

cd "$APP_DIR"

if [ ! -x "$FIREFOX" ]; then
  echo "Firefox was not found at: $FIREFOX"
  echo "Install Firefox, or run with FIREFOX_EXE set to the Firefox executable path."
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm is required to launch this temporary Firefox extension."
  echo "Install Node.js from https://nodejs.org, then run this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -x "$APP_DIR/node_modules/.bin/web-ext" ]; then
  echo "Installing launcher dependency..."
  npm install
fi

echo "Launching Firefox with Cat Auto Catcher..."
"$APP_DIR/node_modules/.bin/web-ext" run \
  --source-dir="$APP_DIR" \
  --firefox="$FIREFOX" \
  --url="$URL" \
  --profile-create-if-missing \
  --firefox-profile="$PROFILE_DIR"
