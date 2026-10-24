#!/bin/bash
# Double-click to start the Test Runner and the ShopEase website (macOS).
# Keep this window open while you use them; closing it stops both.
cd "$(dirname "$0")"
pause_and_exit() { echo; read -r -p "Press Enter to close this window"; exit 1; }

echo "Automated Bug Reporting - starting..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  pause_and_exit
fi
NODE_MAJOR=$(node -p "parseInt(process.versions.node)")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) is too old. Install the LTS version from https://nodejs.org, then double-click this file again."
  pause_and_exit
fi

# First start (or an earlier install that did not finish): install everything
if [ ! -x node_modules/.bin/tsx ] || [ ! -d node_modules/better-sqlite3 ]; then
  echo "First start: installing everything (a few minutes, only once). Please wait..."
  npm install || { echo; echo "Installation FAILED (see the messages above). Check the internet connection and try again."; pause_and_exit; }
  npx playwright install chromium || { echo; echo "Installing the test browser FAILED (see above). Check the internet connection and try again."; pause_and_exit; }
fi

npm start
echo
echo "The Test Runner has stopped. If that happened straight away, the reason is in the messages above."
pause_and_exit
