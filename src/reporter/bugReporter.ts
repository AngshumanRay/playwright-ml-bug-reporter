/**
 * Custom Playwright reporter - the heart of the pipeline (Objectives 1, 2, 3, 7, 8).
 *
 * Playwright calls these hooks while tests run:
 *   onBegin    -> a new row in test_runs
 *   onTestEnd  -> every result is stored in test_results; every FAILURE becomes a bug:
 *                 error message + screenshot + timestamp + module are captured,
 *                 severity is predicted by the ML model, and the bug is saved
 *                 (or, if the same defect is already open, its occurrence count is increased)
 *   onEnd      -> run summary is saved; if any Critical bug was detected in this run, ONE email
 *                 with every Critical bug and its screenshot is sent (the pipeline sends one
 *                 email for all its runs instead)
 *
 * Registered in playwright.config.ts -> reporter: [['./src/reporter/bugReporter.ts']]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { config } from '../config';
import {
  createRun, finishRun, findActiveBug, insertBug, insertTestResult,
  recordOccurrence, timestamp, updateRun,
} from '../db/database';
import { predictSeverity } from '../ml/classifier';
import { stripAnsi } from '../ml/textPreprocessor';
import { sendCriticalAlert } from '../alerts/criticalAlertEmail';
import { SUITE_TAGS } from '../runner/suites';

/** Keeps the useful part of a Playwright error (drops the long "Call log" section). */
export function cleanErrorMessage(message: string): string {
  return stripAnsi(message).split(/\n\s*Call log:/)[0].trim();
}

/** Same test + same error (numbers ignored) = same defect. */
function fingerprint(testKey: string, message: string): string {
  const normalized = message.split('\n').slice(0, 3).join(' ').replace(/\d+/g, '#');
  return crypto.createHash('sha1').update(`${testKey}|${normalized}`).digest('hex');
}

/** The module is the test's tag that does not name a suite (@Login, @Cart, ...). */
function moduleOf(test: TestCase): string {
  const tag = test.tags.find((t) => !SUITE_TAGS.includes(t.toLowerCase()));
  return tag ? tag.slice(1) : 'General';
}

// `playwright test --list` only lists tests: nothing should be recorded
const LIST_ONLY = process.argv.includes('--list');

class BugReporter implements Reporter {
  private runId = 0;
  private startedAt = Date.now();
  private counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  private newBugIds: number[] = [];

  onBegin(_config: FullConfig, suite: Suite): void {
    if (LIST_ONLY) return;
    // A run started from the Test Runner UI already exists (RUN_ID); otherwise create one
    this.runId = Number(process.env.RUN_ID) || createRun(timestamp(), {
      suite: process.env.RUN_SUITE ?? null,
      trigger_source: process.env.BUG_PIPELINE ? 'pipeline' : 'cli',
    });
    updateRun(this.runId, { planned_total: suite.allTests().length });
    this.startedAt = Date.now();
    console.log(`\n[BugReporter] Test run #${this.runId} started - failures will be logged automatically\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (LIST_ONLY) return;
    // With retries, only the final attempt counts
    if (result.status !== 'passed' && result.status !== 'skipped' && result.retry < test.retries) return;

    const testKey = test.titlePath().filter(Boolean).join(' › ');
    const module = moduleOf(test);
    const file = path.relative(process.cwd(), test.location.file);
    const executedAt = timestamp(new Date(result.startTime.getTime() + result.duration));
    const failed = result.status === 'failed' || result.status === 'timedOut';
    const errorMessage = failed
      ? cleanErrorMessage(result.errors.map((e) => e.message ?? e.value ?? '').join('\n\n')) || `Test ${result.status}`
      : null;

    this.counts.total++;
    if (result.status === 'passed') this.counts.passed++;
    else if (result.status === 'skipped') this.counts.skipped++;
    else this.counts.failed++;

    const screenshot = failed ? this.saveScreenshot(result, testKey) : null;
    insertTestResult({
      run_id: this.runId,
      test_key: testKey,
      title: test.title,
      module,
      file,
      status: failed ? 'failed' : result.status,
      duration_ms: result.duration,
      error_message: errorMessage,
      screenshot_path: screenshot,
      line: test.location.line,
      executed_at: executedAt,
    });

    if (!failed) return;
    // Soft assertions (e.g. one per broken link) give several errors: each one is a separate defect
    const messages = result.errors.map((e) => cleanErrorMessage(e.message ?? e.value ?? '')).filter(Boolean);
    if (!messages.length) messages.push(errorMessage ?? `Test ${result.status}`);
    for (const message of messages) {
      const title = messages.length > 1 ? message.split('\n')[0].replace(/^Error:\s*/, '') : test.title;
      this.logBug(test, { testKey, module, file, executedAt, errorMessage: message, title, screenshot, errorStack: result.error?.stack ?? null });
    }
  }

  private logBug(
    test: TestCase,
    info: { testKey: string; module: string; file: string; executedAt: string; errorMessage: string; title: string; screenshot: string | null; errorStack: string | null },
  ): void {
    const { screenshot } = info;
    const fp = fingerprint(info.testKey, info.errorMessage);
    const existing = findActiveBug(fp);

    if (existing) {
      recordOccurrence(existing.id, this.runId, screenshot, info.executedAt);
      console.log(`[BugReporter] Known bug #${existing.id} seen again (${existing.severity}) - ${info.title}`);
      return;
    }

    const prediction = predictSeverity(info.errorMessage);
    const bugId = insertBug({
      fingerprint: fp,
      first_run_id: this.runId,
      test_key: info.testKey,
      title: info.title,
      module: info.module,
      file: info.file,
      browser: test.parent.project()?.name ?? 'unknown',
      error_message: info.errorMessage,
      error_stack: info.errorStack ? stripAnsi(info.errorStack) : null,
      screenshot_path: screenshot,
      severity: prediction.label,
      confidence: prediction.confidence,
      created_at: info.executedAt,
    });
    this.newBugIds.push(bugId);
    console.log(
      `[BugReporter] New bug #${bugId} logged - ${prediction.label} ` +
      `(${(prediction.confidence * 100).toFixed(0)}% confidence) - ${info.title}`,
    );
  }

  /** Copies Playwright's failure screenshot into reports/screenshots (test-results/ is wiped every run). */
  private saveScreenshot(result: TestResult, testKey: string): string | null {
    const shot = result.attachments.find((a) => a.name === 'screenshot' && a.path);
    if (!shot?.path || !fs.existsSync(shot.path)) return null;
    fs.mkdirSync(config.screenshotDir, { recursive: true });
    const slug = testKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(-80);
    const fileName = `run${this.runId}-${slug}.png`;
    fs.copyFileSync(shot.path, path.join(config.screenshotDir, fileName));
    return fileName;
  }

  async onEnd(result: FullResult): Promise<void> {
    if (LIST_ONLY) return;
    finishRun(this.runId, {
      status: result.status,
      ...this.counts,
      duration_ms: Date.now() - this.startedAt,
      new_bugs: this.newBugIds.length,
    });

    if (!process.env.BUG_PIPELINE) {
      // People who get the full run report from the Test Runner are not emailed twice
      const exclude = (process.env.RUN_RECIPIENTS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const outcome = await sendCriticalAlert([this.runId], { exclude });
      console.log(`[BugReporter] ${outcome ? outcome.detail : 'No Critical bug in this run - no email sent'}`);
    }

    const { total, passed, failed } = this.counts;
    console.log(
      `\n[BugReporter] Run #${this.runId} saved: ${total} tests, ${passed} passed, ${failed} failed, ` +
      `${this.newBugIds.length} new bug(s). Reports: npm start → http://localhost:${config.dashboardPort}\n`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default BugReporter;
