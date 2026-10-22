/**
 * One-command start for manual testers:  npm start  (or double-click "Start Test Runner")
 *
 * Trains the ML model if it is missing, starts the dashboard / Test Runner and opens it
 * in the default browser. Set NO_BROWSER=1 to skip opening the browser.
 */
import fs from 'node:fs';
import { exec, spawnSync } from 'node:child_process';
import { config } from '../src/config';

if (!fs.existsSync(config.modelPath)) {
  console.log('Training the severity model (first start only)...');
  spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'src/ml/train.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
}

require('../src/dashboard/server');

const url = `http://localhost:${config.dashboardPort}`;
if (!process.env.NO_BROWSER) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  setTimeout(() => exec(`${opener} ${url}`), 1200);
}
console.log(`\n  Test Runner is ready:  ${url}\n  Keep this window open while you use it. Press Ctrl+C to stop.\n`);
