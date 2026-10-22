/**
 * Everything the run report shows, gathered from the database for one run.
 * Used by the report page in the dashboard, the downloadable HTML report and the report email.
 */
import fs from 'node:fs';
import path from 'node:path';
import ejs from 'ejs';
import { config, SEVERITIES, Severity } from '../config';
import { bugsSeenInRuns, getRun, resultsForRun, TestResultRow, TestRun } from '../db/database';
import { suiteLabel } from './suites';

const SEVERITY_RANK: Record<string, number> = { Critical: 0, Major: 1, Minor: 2 };
const TRIGGER_LABELS: Record<string, string> = { dashboard: 'Test Runner (dashboard)', cli: 'Command line', pipeline: 'Pipeline' };

/** "2026-10-22 13:05 · Smoke · Run #12" - the date prefix keeps runs in order everywhere */
export function runName(run: Pick<TestRun, 'id' | 'started_at' | 'suite'>): string {
  return `${run.started_at.slice(0, 16)} · ${suiteLabel(run.suite)} · Run #${run.id}`;
}

/** "2026-10-22_1305_smoke_run-12" - used for report file names */
export function runFileSlug(run: Pick<TestRun, 'id' | 'started_at' | 'suite'>): string {
  const [date, time] = run.started_at.split(' ');
  return `${date}_${time.slice(0, 5).replace(':', '')}_${run.suite ?? 'cli'}_run-${run.id}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export type ResultWithBugs = TestResultRow & { bugs: { id: number; severity: Severity; title: string }[]; severity: Severity | null };

export function getRunReport(runId: number) {
  const run = getRun(runId);
  if (!run) return null;

  const bugs = bugsSeenInRuns([runId]).map((b) => ({ ...b, isNew: b.first_run_id === runId }));
  const results: ResultWithBugs[] = resultsForRun(runId).map((r) => {
    const own = bugs.filter((b) => b.test_key === r.test_key).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    return { ...r, bugs: own.map((b) => ({ id: b.id, severity: b.severity, title: b.title })), severity: own[0]?.severity ?? null };
  });

  const moduleNames = [...new Set(results.map((r) => r.module))].sort();
  const modules = moduleNames.map((m) => {
    const rs = results.filter((r) => r.module === m);
    return { module: m, total: rs.length, passed: rs.filter((r) => r.status === 'passed').length, failed: rs.filter((r) => r.status === 'failed').length };
  });

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const total = results.length;
  const finished = run.status !== 'running';

  return {
    run,
    name: runName(run),
    slug: runFileSlug(run),
    suiteName: suiteLabel(run.suite),
    trigger: TRIGGER_LABELS[run.trigger_source ?? 'cli'] ?? run.trigger_source,
    finished,
    passedRun: finished && failed === 0 && total > 0 && run.status !== 'stopped',
    total,
    planned: run.planned_total ?? total,
    passed,
    failed,
    skipped: results.filter((r) => r.status === 'skipped').length,
    passRate: total ? Math.round((passed / total) * 100) : 0,
    duration: formatDuration(run.duration_ms || (results.length ? results.reduce((n, r) => n + r.duration_ms, 0) : 0)),
    results,
    modules,
    bugs: bugs.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id - b.id),
    severityCounts: SEVERITIES.map((s) => ({ severity: s, count: bugs.filter((b) => b.severity === s).length })),
    criticalBugs: bugs.filter((b) => b.severity === 'Critical'),
    recipients: (run.recipients ?? '').split(',').filter(Boolean),
  };
}

export type RunReport = NonNullable<ReturnType<typeof getRunReport>>;

/**
 * The run report as ONE self-contained HTML file (styles and screenshots embedded),
 * so it can be downloaded, attached to an email and opened anywhere.
 */
export async function renderStandaloneReport(runId: number): Promise<string | null> {
  const report = getRunReport(runId);
  if (!report) return null;
  const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'public', 'dashboard.css'), 'utf8');
  const shotSrc = (file: string | null) => {
    if (!file) return null;
    const p = path.join(config.screenshotDir, file);
    return fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : null;
  };
  return ejs.renderFile(path.join(__dirname, '..', 'dashboard', 'views', 'report-standalone.ejs'), {
    report, css, shotSrc, standalone: true, generatedAt: new Date().toLocaleString(),
  });
}

/** Writes the standalone report to reports/runs/<date-prefixed name>.html and returns its path. */
export async function saveReportFile(runId: number): Promise<string | null> {
  const report = getRunReport(runId);
  const html = await renderStandaloneReport(runId);
  if (!report || !html) return null;
  fs.mkdirSync(config.runReportDir, { recursive: true });
  const file = path.join(config.runReportDir, `${report.slug}.html`);
  fs.writeFileSync(file, html);
  return file;
}
