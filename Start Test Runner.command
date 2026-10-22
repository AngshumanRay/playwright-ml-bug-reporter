#!/bin/bash
# Double-click to start the Test Runner (macOS). Keep the window open while you use it.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  read -r -p "Press Enter to close"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First start: installing everything (this takes a few minutes, only once)..."
  npm install && npx playwright install chromium || { read -r -p "Installation failed. Press Enter to close"; exit 1; }
fi
npm start
