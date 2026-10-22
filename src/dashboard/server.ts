/**
 * Web dashboard and Test Runner (Objectives 4, 5, 6 + Test Runner UI).
 *
 *   npm start   ->  http://localhost:3000
 *
 *   /                  Test Runner: choose a suite, enter email ID(s), Run; live progress
 *   /runs              run history, every run named with its date first
 *   /runs/:id          run report (also downloadable as one HTML file)
 *   /analytics         KPI cards + charts (bugs per module, severity distribution, 14-day trend)
 *   /bugs, /bugs/:id   bug list (filter, search, status update) and bug details
 *   /flaky             flaky test detection across runs
 */
import { exec } from 'node:child_process';
import path from 'node:path';
import express from 'express';
import { config, BUG_STATUSES, SEVERITIES, BugStatus, ROOT_DIR } from '../config';
import {
  bugTrend, bugsPerModule, getBug, getBugHistory, getRun, listBugs, listModules, listRuns,
  overviewCounts, resultsForRun, severityDistribution, updateBugStatus,
} from '../db/database';
import { analyzeTestStability } from '../flaky/flakyDetector';
import { isEmailConfigured } from '../alerts/emailNotifier';
import { SUITES, suiteLabel } from '../runner/suites';
import { EmailMode, activeRunId, parseRecipients, runLog, startRun, stopRun } from '../runner/runManager';
import { getRunReport, renderStandaloneReport, runName, formatDuration } from '../runner/runReport';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(config.screenshotDir));

// Values available in every template
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.SEVERITIES = SEVERITIES;
  res.locals.BUG_STATUSES = BUG_STATUSES;
  res.locals.activeRunId = activeRunId();
  next();
});

// ------------------------------------------------------------------ Test Runner

// Number of tests in each suite, counted once at start-up with `playwright test --list`
const suiteCounts: Record<string, number | null> = Object.fromEntries(SUITES.map((s) => [s.id, null]));
for (const suite of SUITES) {
  exec(`npx playwright test --list${suite.grep ? ` --grep ${suite.grep}` : ''}`, { cwd: ROOT_DIR }, (_err, stdout) => {
    const m = /Total: (\d+) test/.exec(stdout ?? '');
    suiteCounts[suite.id] = m ? Number(m[1]) : null;
  });
}

const runSummary = (r: ReturnType<typeof listRuns>[number]) => ({
  id: r.id,
  name: runName(r),
  date: r.started_at.slice(0, 10),
  time: r.started_at.slice(11, 16),
  suite: suiteLabel(r.suite),
  status: r.status,
  total: r.total,
  passed: r.passed,
  failed: r.failed,
  newBugs: r.new_bugs,
  duration: formatDuration(r.duration_ms),
  trigger: r.trigger_source ?? 'cli',
});

app.get('/', (_req, res) => {
  res.render('runner', {
    title: 'Test Runner',
    suites: SUITES.map((s) => ({ ...s, count: suiteCounts[s.id] })),
    emailConfigured: isEmailConfigured(),
    emailFrom: config.alerts.from,
    recent: listRuns(8).map(runSummary),
  });
});

app.post('/api/runs', (req, res) => {
  const { suite, emails = '', emailMode = 'always' } = req.body ?? {};
  const { valid, invalid } = parseRecipients(String(emails));
  if (invalid.length) {
    res.status(400).json({ error: `Not a valid email address: ${invalid.join(', ')}` });
    return;
  }
  try {
    const runId = startRun(String(suite), valid, emailMode === 'critical' ? 'critical' : ('always' as EmailMode));
    res.json({ runId });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

app.get('/api/runs/active', (_req, res) => {
  res.json({ runId: activeRunId() });
});

app.get('/api/runs/recent', (_req, res) => {
  res.json(listRuns(8).map(runSummary));
});

app.get('/api/runs/:id/live', (req, res) => {
  const id = Number(req.params.id);
  const run = getRun(id);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  const results = resultsForRun(id);
  const started = new Date(run.started_at.replace(' ', 'T')).getTime();
  res.json({
    id,
    name: runName(run),
    status: run.status,
    active: activeRunId() === id,
    planned: run.planned_total,
    done: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    elapsedMs: (run.finished_at ? new Date(run.finished_at.replace(' ', 'T')).getTime() : Date.now()) - started,
    emailStatus: run.email_status,
    results: results.map((r) => ({ title: r.title, module: r.module, status: r.status, duration: r.duration_ms })),
    log: runLog(id).slice(-80),
  });
});

app.post('/api/runs/:id/stop', (req, res) => {
  res.json({ stopped: stopRun(Number(req.params.id)) });
});

// ------------------------------------------------------------------ run history and reports

app.get('/runs', (req, res) => {
  const suite = String(req.query.suite ?? '');
  const runs = listRuns(500).filter((r) => !suite || (suite === 'cli' ? !r.suite : r.suite === suite)).map(runSummary);
  const days = [...new Set(runs.map((r) => r.date))].map((date) => ({ date, runs: runs.filter((r) => r.date === date) }));
  res.render('history', { title: 'Run History', days, suite, suites: SUITES, total: runs.length });
});

app.get('/runs/:id', (req, res) => {
  const report = getRunReport(Number(req.params.id));
  if (!report) {
    res.status(404).render('not-found', { title: 'Not found' });
    return;
  }
  res.render('report', {
    title: report.name, report, standalone: false, autoRefresh: report.run.status === 'running',
    shotSrc: (f: string | null) => (f ? `/screenshots/${f}` : null),
  });
});

app.get('/runs/:id/download', async (req, res) => {
  const report = getRunReport(Number(req.params.id));
  const html = report && (await renderStandaloneReport(report.run.id));
  if (!report || !html) {
    res.status(404).send('Run not found');
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="${report.slug}.html"`);
  res.type('html').send(html);
});

// ------------------------------------------------------------------ analytics, bugs, flaky

app.get('/analytics', (_req, res) => {
  const stability = analyzeTestStability();
  const severity = SEVERITIES.map((s) => ({
    severity: s,
    count: severityDistribution().find((d) => d.severity === s)?.count ?? 0,
  }));
  res.render('overview', {
    title: 'Analytics',
    counts: overviewCounts(),
    flakyCount: stability.filter((s) => s.verdict === 'Flaky').length,
    analytics: { perModule: bugsPerModule(), severity, trend: bugTrend(14) },
    runs: listRuns(5),
  });
});

app.get('/bugs', (req, res) => {
  const filter = {
    severity: String(req.query.severity ?? ''),
    status: String(req.query.status ?? ''),
    module: String(req.query.module ?? ''),
    q: String(req.query.q ?? '').trim(),
  };
  const flakyTests = new Set(analyzeTestStability().filter((s) => s.verdict === 'Flaky').map((s) => s.testKey));
  res.render('bugs', { title: 'Bugs', bugs: listBugs(filter), filter, modules: listModules(), flakyTests });
});

app.get('/bugs/:id', (req, res) => {
  const bug = getBug(Number(req.params.id));
  if (!bug) {
    res.status(404).render('not-found', { title: 'Not found' });
    return;
  }
  const stability = analyzeTestStability().find((s) => s.testKey === bug.test_key);
  res.render('bug', { title: `Bug #${bug.id}`, bug, history: getBugHistory(bug.id), stability });
});

app.post('/bugs/:id/status', (req, res) => {
  const status = req.body.status as BugStatus;
  if (BUG_STATUSES.includes(status)) updateBugStatus(Number(req.params.id), status);
  const back = typeof req.body.redirect === 'string' && req.body.redirect.startsWith('/') ? req.body.redirect : `/bugs/${req.params.id}`;
  res.redirect(back);
});

app.get('/flaky', (_req, res) => {
  res.render('flaky', { title: 'Flaky Tests', stability: analyzeTestStability(), windowRuns: config.flaky.windowRuns, minRuns: config.flaky.minRuns });
});

app.listen(config.dashboardPort, () => {
  console.log(`Test Runner and dashboard running at http://localhost:${config.dashboardPort}`);
});
