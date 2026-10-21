/**
 * Web dashboard (Objectives 4, 5, 6).
 *
 *   npm run dashboard   ->  http://localhost:3000
 *
 *   /             overview: KPI cards + charts (bugs per module, severity distribution, 14-day trend)
 *   /bugs         bug list with filter (severity, status, module) and text search
 *   /bugs/:id     bug details: error, screenshot, ML prediction, status history, status update
 *   /flaky        flaky test detection across runs
 *   /runs         test run summaries
 */
import path from 'node:path';
import express from 'express';
import { config, BUG_STATUSES, SEVERITIES, BugStatus } from '../config';
import {
  bugTrend, bugsPerModule, getBug, getBugHistory, listBugs, listModules, listRuns,
  overviewCounts, severityDistribution, updateBugStatus,
} from '../db/database';
import { analyzeTestStability } from '../flaky/flakyDetector';

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(config.screenshotDir));

// Values available in every template
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.SEVERITIES = SEVERITIES;
  res.locals.BUG_STATUSES = BUG_STATUSES;
  next();
});

app.get('/', (_req, res) => {
  const stability = analyzeTestStability();
  const severity = SEVERITIES.map((s) => ({
    severity: s,
    count: severityDistribution().find((d) => d.severity === s)?.count ?? 0,
  }));
  res.render('overview', {
    title: 'Overview',
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

app.get('/runs', (_req, res) => {
  res.render('runs', { title: 'Test Runs', runs: listRuns(100) });
});

app.listen(config.dashboardPort, () => {
  console.log(`Bug dashboard running at http://localhost:${config.dashboardPort}`);
});
