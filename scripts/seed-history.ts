/**
 * OPTIONAL - adds SIMULATED history for the previous 13 days so the 14-day trend chart
 * can be demonstrated on a fresh install (real data only exists for the days you ran tests).
 *
 *   npm run seed:history
 *
 * Simulated bugs use error messages from the labelled dataset; their severity is still
 * predicted by the ML model. They are marked with the browser value "simulated" and
 * file value "simulated-history", so they can always be told apart from real bugs.
 * Use "npm run db:reset" to remove everything.
 */
import crypto from 'node:crypto';
import { BugStatus } from '../src/config';
import { createRun, finishRun, getDb, insertBug, timestamp, updateBugStatus } from '../src/db/database';
import { predictSeverity } from '../src/ml/classifier';
import { loadDataset } from '../src/ml/train';

const MODULE_KEYWORDS: [string, RegExp][] = [
  ['Login', /login|sign in|password|session|auth|username/i],
  ['Checkout', /checkout|payment|order|shipping|tax|zip|transaction/i],
  ['Cart', /cart|quantity|coupon|discount|subtotal/i],
  ['Search', /search|filter|sort|product|catalogue|categor/i],
  ['Profile', /profile|account|address|label|avatar/i],
];
const MODULES = MODULE_KEYWORDS.map(([m]) => m);

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
const shorten = (text: string, max = 70) => (text.length <= max ? text : text.slice(0, text.lastIndexOf(' ', max)) + '…');

const samples = loadDataset();
const db = getDb();

let created = 0;
for (let daysBack = 13; daysBack >= 1; daysBack--) {
  const day = new Date();
  day.setDate(day.getDate() - daysBack);
  day.setHours(9 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0, 0);

  const runId = createRun(timestamp(day));
  const newBugs = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < newBugs; i++) {
    const sample = pick(samples);
    const module = MODULE_KEYWORDS.find(([, re]) => re.test(sample.text))?.[0] ?? pick(MODULES);
    const prediction = predictSeverity(sample.text);
    const id = insertBug({
      fingerprint: crypto.randomUUID(),
      first_run_id: runId,
      test_key: `simulated › ${module} › ${sample.text.slice(0, 50)}`,
      title: shorten(sample.text),
      module,
      file: 'simulated-history',
      browser: 'simulated',
      error_message: `Error: ${sample.text}`,
      error_stack: null,
      screenshot_path: null,
      severity: prediction.label,
      confidence: prediction.confidence,
      created_at: timestamp(new Date(day.getTime() + i * 60_000)),
    });
    // Older simulated bugs have mostly been worked on already
    const status: BugStatus = daysBack > 6 ? pick<BugStatus>(['Resolved', 'Resolved', 'In Progress'])
      : pick<BugStatus>(['Open', 'In Progress', 'Resolved']);
    if (status !== 'Open') updateBugStatus(id, 'In Progress');
    if (status === 'Resolved') updateBugStatus(id, 'Resolved');
    created++;
  }
  const total = 16;
  const failed = newBugs + Math.floor(rand() * 3);
  finishRun(runId, { status: 'failed', total, passed: total - failed, failed, skipped: 0, duration_ms: 9000 + Math.floor(rand() * 4000), new_bugs: newBugs },
    timestamp(new Date(day.getTime() + 15_000)));
}
db.close();
console.log(`Simulated history added: 13 runs and ${created} bugs over the previous 13 days.`);
