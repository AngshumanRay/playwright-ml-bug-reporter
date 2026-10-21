/**
 * End-to-end pipeline (Objective 8):
 *
 *   test execution -> failure detection -> ML severity prediction -> storage -> dashboard
 *
 *   npm run pipeline                      # train model (if needed) + run the suite 5 times
 *   npm run pipeline -- --runs=10         # choose the number of runs
 *   npm run pipeline -- --retrain         # retrain the ML model first
 *   npm run pipeline -- --dashboard       # start the dashboard at the end
 *
 * At the end an HTML results report is written to reports/bug-report.html.
 *
 * The suite is executed several times so that flaky tests (pass in one run, fail in another)
 * can be detected.
 */
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { config } from '../src/config';
import { listRuns, overviewCounts, severityDistribution } from '../src/db/database';
import { detectFlakyTests } from '../src/flaky/flakyDetector';

const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 5);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function step(n: number, title: string) {
  console.log(`\n${'='.repeat(70)}\n STEP ${n}: ${title}\n${'='.repeat(70)}`);
}

// 1. Machine learning model
step(1, 'ML severity model');
if (args.includes('--retrain') || !fs.existsSync(config.modelPath)) {
  spawnSync(npx, ['tsx', 'src/ml/train.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
} else {
  console.log('Trained model found - skipping training (use --retrain to train again)');
}

// 2-4. Run the Playwright suite N times; the BugReporter captures, classifies and stores failures
step(2, `Playwright test execution x ${runs} (failure capture -> ML severity -> SQLite)`);
for (let i = 1; i <= runs; i++) {
  console.log(`\n---------------- Run ${i} of ${runs} ----------------`);
  // A non-zero exit code is expected here: the demo application contains seeded defects
  spawnSync(npx, ['playwright', 'test', '--reporter=dot,html,./src/reporter/bugReporter.ts'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never', PLAYWRIGHT_HTML_OUTPUT_DIR: 'reports/playwright-html' },
  });
}

// 5. Flaky test detection
step(3, 'Flaky test detection across runs');
const flaky = detectFlakyTests();
if (!flaky.length) console.log('No flaky tests detected.');
for (const t of flaky) {
  console.log(`  FLAKY  ${t.testKey}\n         history ${t.history}  failure rate ${(t.failureRate * 100).toFixed(0)}%  flip rate ${(t.flipRate * 100).toFixed(0)}%`);
}

// 6. Summary
step(4, 'Summary');
const counts = overviewCounts();
const latest = listRuns(runs);
console.log(`Runs executed now : ${latest.map((r) => `#${r.id} (${r.passed}/${r.total} passed)`).join(', ')}`);
console.log(`Bugs in database  : ${counts.totalBugs} (open ${counts.openBugs}, in progress ${counts.inProgressBugs}, resolved ${counts.resolvedBugs})`);
console.log(`By severity       : ${severityDistribution().map((s) => `${s.severity} ${s.count}`).join(', ')}`);
console.log(`Flaky tests       : ${flaky.length}`);
console.log(`Alert previews    : reports/alerts/  (real emails when ALERTS_ENABLED=true in .env)`);

step(5, 'Report');
spawnSync(npx, ['tsx', 'scripts/generate-report.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
console.log('Playwright HTML report (last run): reports/playwright-html/index.html');

if (args.includes('--dashboard')) {
  step(6, 'Dashboard');
  spawn(npx, ['tsx', 'src/dashboard/server.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
} else {
  console.log(`\nOpen the dashboard:  npm run dashboard   ->  http://localhost:${config.dashboardPort}\n`);
}
