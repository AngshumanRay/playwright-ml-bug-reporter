/**
 * Custom Playwright reporter - the heart of the pipeline (Objectives 1, 2, 3, 7, 8).
 *
 * Playwright calls these hooks while tests run:
 *   onBegin    -> a new row in test_runs
 *   onTestEnd  -> every result is stored in test_results; every FAILURE becomes a bug:
 *                 error message + screenshot + timestamp + module are captured,
 *                 severity is predicted by the ML model, and the bug is saved
 *                 (or, if the same defect is already open, its occurrence count is increased)
 *   onEnd      -> run summary is saved and email alerts are sent for new Critical bugs
 *
 * Registered in playwright.config.ts -> reporter: [['./src/reporter/bugReporter.ts']]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { config } from '../config';
import {
  createRun, finishRun, findActiveBug, getBug, insertBug, insertTestResult,
  markAlertSent, recordOccurrence, timestamp,
} from '../db/database';
import { predictSeverity } from '../ml/classifier';
import { stripAnsi } from '../ml/textPreprocessor';
import { sendCriticalBugAlert } from '../alerts/emailNotifier';

/** Keeps the useful part of a Playwright error (drops the long "Call log" section). */
export function cleanErrorMessage(message: string): string {
  return stripAnsi(message).split(/\n\s*Call log:/)[0].trim();
}

/** Same test + same error (numbers ignored) = same defect. */
function fingerprint(testKey: string, message: string): string {
  const normalized = message.split('\n').slice(0, 3).join(' ').replace(/\d+/g, '#');
  return crypto.createHash('sha1').update(`${testKey}|${normalized}`).digest('hex');
}

function moduleOf(test: TestCase): string {
  const tag = test.tags.find((t) => t.startsWith('@'));
  return tag ? tag.slice(1) : 'General';
}

class BugReporter implements Reporter {
  private runId = 0;
  private startedAt = Date.now();
  private counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  private newBugIds: number[] = [];

  onBegin(): void {
    this.runId = createRun();
    this.startedAt = Date.now();
    console.log(`\n[BugReporter] Test run #${this.runId} started - failures will be logged automatically\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
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

    insertTestResult({
      run_id: this.runId,
      test_key: testKey,
      title: test.title,
      module,
      file,
      status: failed ? 'failed' : result.status,
      duration_ms: result.duration,
      error_message: errorMessage,
      executed_at: executedAt,
    });

    if (failed && errorMessage) this.logBug(test, result, { testKey, module, file, executedAt, errorMessage });
  }

  private logBug(
    test: TestCase,
    result: TestResult,
    info: { testKey: string; module: string; file: string; executedAt: string; errorMessage: string },
  ): void {
    const screenshot = this.saveScreenshot(result, info.testKey);
    const fp = fingerprint(info.testKey, info.errorMessage);
    const existing = findActiveBug(fp);

    if (existing) {
      recordOccurrence(existing.id, this.runId, screenshot, info.executedAt);
      console.log(`[BugReporter] Known bug #${existing.id} seen again (${existing.severity}) - ${info.testKey}`);
      return;
    }

    const prediction = predictSeverity(info.errorMessage);
    const bugId = insertBug({
      fingerprint: fp,
      first_run_id: this.runId,
      test_key: info.testKey,
      title: test.title,
      module: info.module,
      file: info.file,
      browser: test.parent.project()?.name ?? 'unknown',
      error_message: info.errorMessage,
      error_stack: result.error?.stack ? stripAnsi(result.error.stack) : null,
      screenshot_path: screenshot,
      severity: prediction.label,
      confidence: prediction.confidence,
      created_at: info.executedAt,
    });
    this.newBugIds.push(bugId);
    console.log(
      `[BugReporter] New bug #${bugId} logged - ${prediction.label} ` +
      `(${(prediction.confidence * 100).toFixed(0)}% confidence) - ${info.testKey}`,
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
    finishRun(this.runId, {
      status: result.status,
      ...this.counts,
      duration_ms: Date.now() - this.startedAt,
      new_bugs: this.newBugIds.length,
    });

    for (const id of this.newBugIds) {
      const bug = getBug(id);
      if (bug?.severity !== 'Critical') continue;
      const outcome = await sendCriticalBugAlert(bug);
      if (outcome.sent) markAlertSent(id);
      console.log(`[BugReporter] ${outcome.detail}`);
    }

    const { total, passed, failed } = this.counts;
    console.log(
      `\n[BugReporter] Run #${this.runId} saved: ${total} tests, ${passed} passed, ${failed} failed, ` +
      `${this.newBugIds.length} new bug(s). Dashboard: npm run dashboard\n`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}

export default BugReporter;
