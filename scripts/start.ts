/**
 * One-command start for manual testers:  npm start  (or double-click "Start Test Runner")
 *
 * Trains the ML model if it is missing, starts the ShopEase website under test and the
 * dashboard / Test Runner, and opens the Test Runner in the default browser.
 * Set NO_BROWSER=1 to skip opening the browser.
 */
import fs from 'node:fs';
import { exec, spawnSync } from 'node:child_process';
import { config } from '../src/config';

if (!fs.existsSync(config.modelPath)) {
  console.log('Training the severity model (first start only)...');
  spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'src/ml/train.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
}

require('../demo-app/server'); // ShopEase, so it can also be tested by hand at http://localhost:4000
require('../src/dashboard/server');

const url = `http://localhost:${config.dashboardPort}`;
const shopUrl = `http://localhost:${config.demoAppPort}/login.html`;

// Make sure the site on the ShopEase port really is ShopEase (another program may use the port)
setTimeout(async () => {
  try {
    const page = await (await fetch(shopUrl)).text();
    if (!page.includes('ShopEase')) throw new Error('another program answers on this port');
    console.log(`  ✓ ShopEase is up:  ${shopUrl}`);
  } catch (err) {
    console.log(`\n  ✗ ShopEase could not be opened at ${shopUrl} (${(err as Error).message}).`);
    console.log(`    Another program may be using port ${config.demoAppPort}. Set DEMO_APP_PORT=4010 in .env and start again.\n`);
  }
}, 1500);
if (!process.env.NO_BROWSER) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  setTimeout(() => exec(`${opener} ${url}`), 1200);
}
console.log(`\n  Test Runner is ready:      ${url}\n  ShopEase (site under test): http://localhost:${config.demoAppPort}   (login: student / Password@123)\n  Keep this window open while you use them. Press Ctrl+C to stop.\n`);
