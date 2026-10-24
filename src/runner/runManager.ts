/**
 * Starts and stops Playwright runs for the Test Runner page of the dashboard.
 *
 * - One run at a time. The run row is created here first, so the page can follow it at once;
 *   the BugReporter then fills it in (RUN_ID is passed to it).
 * - The Playwright output is kept so the page can show a live log.
 * - When the run ends: a self-contained, date-named report is saved in reports/runs/ and
 *   emailed to the addresses entered in the Test Runner.
 */
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT_DIR } from '../config';
import { bugsSeenInRuns, createRun, finishRun as saveRunTotals, getRun, resultsForRun, timestamp, updateRun } from '../db/database';
import { sendRunReport } from '../alerts/runReportEmail';
import { stripAnsi } from '../ml/textPreprocessor';
import { getSuite } from './suites';
import { saveReportFile } from './runReport';

export type EmailMode = 'always' | 'critical';

interface ActiveRun {
  runId: number;
  child: ChildProcess;
  stopping: boolean;
}

const MAX_LOG_LINES = 400;
const logs = new Map<number, string[]>();
let active: ActiveRun | null = null;
// Playwright is started through Node directly (no shell), so test filters pass through unchanged on every OS
const PLAYWRIGHT_CLI = path.join(ROOT_DIR, 'node_modules', '@playwright', 'test', 'cli.js');

export function activeRunId(): number | null {
  return active?.runId ?? null;
}

export function runLog(runId: number): string[] {
  return logs.get(runId) ?? [];
}

export function parseRecipients(input: string): { valid: string[]; invalid: string[] } {
  const parts = input.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  return { valid: [...new Set(parts.filter(isEmail).map((e) => e.toLowerCase()))], invalid: parts.filter((p) => !isEmail(p)) };
}

export interface RunOptions {
  headed?: boolean; // show the browser (one test at a time in one window)
  rerunOf?: number; // re-run of this run's failed tests
  tests?: string[]; // exact tests as "file:line"
  grep?: string; // or a title filter
}

export function startRun(suiteId: string, recipients: string[], emailMode: EmailMode, options: RunOptions = {}): number {
  if (active) throw new Error(`Run #${active.runId} is still in progress. Wait for it to finish or stop it first.`);
  const suite = getSuite(suiteId);
  if (!suite) throw new Error(`Unknown suite "${suiteId}"`);

  const runId = createRun(timestamp(), {
    suite: suite.id,
    trigger_source: 'dashboard',
    recipients: recipients.join(','),
    email_mode: emailMode,
    rerun_of: options.rerunOf ?? null,
    headed: options.headed ?? false,
  });

  const filter = options.tests?.length ? options.tests
    : options.grep ? ['--grep', options.grep]
    : suite.grep ? ['--grep', suite.grep] : [];
  const visible = options.headed ? ['--headed', '--workers=1'] : [];
  const args = ['test', ...filter, ...visible, '--reporter=list,./src/reporter/bugReporter.ts'];
  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...args], {
    cwd: ROOT_DIR,
    env: { ...process.env, RUN_ID: String(runId), RUN_SUITE: suite.id, RUN_RECIPIENTS: recipients.join(','), FORCE_COLOR: '0' },
  });

  const log: string[] = [`$ npx playwright ${args.join(' ')}`];
  logs.set(runId, log);
  const collect = (chunk: Buffer) => {
    for (const line of stripAnsi(chunk.toString()).split(/\r?\n/)) {
      if (!line.trim()) continue;
      log.push(line);
      if (log.length > MAX_LOG_LINES) log.shift();
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  active = { runId, child, stopping: false };
  child.on('close', (code) => {
    const stopped = active?.runId === runId && active.stopping;
    active = null;
    finishRun(runId, code, stopped).catch((err) => log.push(`Could not finish the run: ${(err as Error).message}`));
  });
  child.on('error', (err) => log.push(`Could not start Playwright: ${err.message}`));
  return runId;
}

/**
 * Starts a new run with the tests that failed in `runId` (all of them, or only `resultId`),
 * for the same suite, email recipients and browser visibility.
 */
export function rerunFailed(runId: number, resultId?: number): number {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found');
  const failed = resultsForRun(runId).filter((r) => r.status === 'failed' && (!resultId || r.id === resultId));
  if (!failed.length) throw new Error(resultId ? 'That test did not fail in this run.' : `Run #${runId} has no failed tests to re-run.`);

  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = failed.every((r) => r.line);
  return startRun(run.suite ?? 'regression', (run.recipients ?? '').split(',').filter(Boolean), (run.email_mode as EmailMode) ?? 'critical', {
    rerunOf: runId,
    headed: !(run.trigger_source === 'dashboard' && run.headed === 0), // visible unless that run had it switched off
    // exact file:line when known; older runs (before lines were recorded) fall back to the test titles
    tests: exact ? [...new Set(failed.map((r) => `${r.file}:${r.line}`))] : undefined,
    grep: exact ? undefined : failed.map((r) => escape(r.title)).join('|'),
  });
}

export function stopRun(runId: number): boolean {
  if (!active || active.runId !== runId) return false;
  active.stopping = true;
  active.child.kill('SIGTERM');
  return true;
}

async function finishRun(runId: number, exitCode: number | null, stopped: boolean): Promise<void> {
  const log = logs.get(runId) ?? [];
  const run = getRun(runId);
  if (!run) return;
  if (stopped || run.status === 'running') {
    // Playwright was stopped (or crashed) before the reporter saved the totals: count the saved results
    const results = resultsForRun(runId);
    const started = new Date(run.started_at.replace(' ', 'T')).getTime();
    saveRunTotals(runId, {
      status: stopped ? 'stopped' : 'error',
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      duration_ms: Date.now() - started,
      new_bugs: bugsSeenInRuns([runId]).filter((b) => b.first_run_id === runId).length,
    });
  }
  log.push(`Playwright finished (exit code ${exitCode ?? 'none'})`);

  const reportFile = await saveReportFile(runId);
  if (reportFile) {
    updateRun(runId, { report_file: reportFile });
    log.push(`Report saved: ${reportFile.replace(ROOT_DIR + '/', '')}`);
  }

  const recipients = (run.recipients ?? '').split(',').filter(Boolean);
  if (!recipients.length) {
    updateRun(runId, { email_status: 'No email address entered' });
    return;
  }
  const hasCritical = bugsSeenInRuns([runId]).some((b) => b.severity === 'Critical');
  if (run.email_mode === 'critical' && !hasCritical) {
    updateRun(runId, { email_status: 'Not sent: no Critical bug found' });
    log.push('Report email not sent: no Critical bug found');
    return;
  }
  const outcome = await sendRunReport(runId, recipients, reportFile);
  const status = !outcome ? 'Not sent'
    : outcome.sent ? `Sent to ${recipients.join(', ')}`
    : outcome.detail.includes('FAILED') ? outcome.detail.replace(/^.*FAILED: /, 'NOT SENT: ')
    : 'NOT SENT: no sending email account is set up in .env';
  updateRun(runId, { email_status: status });
  log.push(`Report email: ${status}`);
}
