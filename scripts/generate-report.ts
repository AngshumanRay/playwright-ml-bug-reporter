/**
 * Generates a single self-contained HTML report of the results (screenshots embedded),
 * suitable for sharing, printing or saving as PDF from the browser.
 *
 *   npm run report   ->  reports/bug-report.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR, SEVERITIES } from '../src/config';
import {
  Bug, bugTrend, bugsPerModule, listBugs, listRuns, overviewCounts, severityDistribution, timestamp,
} from '../src/db/database';
import { analyzeTestStability } from '../src/flaky/flakyDetector';

const OUTPUT = path.join(ROOT_DIR, 'reports', 'bug-report.html');

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const sevPill = (s: string) => `<span class="pill sev-${s}">${s}</span>`;
const statusPill = (s: string) => `<span class="pill st-${s.replace(' ', '-')}">${s}</span>`;

function screenshotDataUri(bug: Bug): string | null {
  if (!bug.screenshot_path) return null;
  const file = path.join(config.screenshotDir, bug.screenshot_path);
  return fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : null;
}

/** Horizontal bar list: label, bar, value. */
function barList(rows: { label: string; value: number; cls?: string }[]): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="barlist">${rows.map((r) => `
    <div class="barlist-row">
      <span class="barlist-label">${esc(r.label)}</span>
      <span class="barlist-track"><span class="barlist-fill ${r.cls ?? ''}" style="width:${(r.value / max) * 100}%"></span></span>
      <span class="barlist-value">${r.value}</span>
    </div>`).join('')}</div>`;
}

/** Stacked daily columns for the 14-day trend (inline SVG, no external library). */
function trendSvg(trend: ReturnType<typeof bugTrend>): string {
  const w = 760, h = 220, padL = 28, padB = 26, padT = 10;
  const max = Math.max(1, ...trend.map((d) => d.Critical + d.Major + d.Minor));
  const step = (w - padL) / trend.length;
  const barW = Math.min(34, step * 0.6);
  const y = (v: number) => padT + (h - padT - padB) * (1 - v / max);
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  let svg = `<svg viewBox="0 0 ${w} ${h}" class="trend" role="img" aria-label="New bugs per day for the last 14 days, stacked by severity">`;
  for (const t of ticks) {
    svg += `<line x1="${padL}" x2="${w}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}</text>`;
  }
  trend.forEach((d, i) => {
    const x = padL + i * step + (step - barW) / 2;
    let base = 0;
    for (const s of SEVERITIES) {
      const v = d[s];
      if (!v) continue;
      const top = y(base + v), bottom = y(base);
      svg += `<rect x="${x}" y="${top}" width="${barW}" height="${Math.max(0, bottom - top)}" class="seg-${s}"><title>${d.date} - ${s}: ${v}</title></rect>`;
      base += v;
    }
    svg += `<text x="${x + barW / 2}" y="${h - 8}" class="tick" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  return svg + '</svg>';
}

function main() {
  const counts = overviewCounts();
  const runs = listRuns(1000).slice().reverse();
  const bugs = listBugs().slice().reverse();
  const stability = analyzeTestStability();
  const flaky = stability.filter((s) => s.verdict === 'Flaky');
  const flakyKeys = new Set(flaky.map((f) => f.testKey));
  const severity = SEVERITIES.map((s) => ({ s, n: severityDistribution().find((d) => d.severity === s)?.count ?? 0 }));
  const trend = bugTrend(14);
  const model = fs.existsSync(config.modelPath) ? JSON.parse(fs.readFileSync(config.modelPath, 'utf8')) : null;
  const pwVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version;

  const executions = runs.reduce((n, r) => n + r.total, 0);
  const passedExecutions = runs.reduce((n, r) => n + r.passed, 0);
  const criticalBugs = bugs.filter((b) => b.severity === 'Critical');
  const simulated = bugs.filter((b) => b.file === 'simulated-history').length;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bug Report</title>
<style>
:root { color-scheme: light; --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,.10);
  --accent:#2a78d6; --critical:#d03b3b; --major:#ec835a; --minor:#fab219; --good:#0ca30c; --good-text:#006300; --flaky:#e87ba4; --code:rgba(11,11,11,.05); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --page:#0d0d0d; --surface:#1a1a19; --ink:#f0efec; --ink-2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10); --accent:#3987e5; --good-text:#0ca30c; --code:rgba(255,255,255,.06); } }
:root[data-theme="dark"] { color-scheme: dark; --page:#0d0d0d; --surface:#1a1a19; --ink:#f0efec; --ink-2:#c3c2b7; --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10); --accent:#3987e5; --good-text:#0ca30c; --code:rgba(255,255,255,.06); }
* { box-sizing: border-box; }
body { margin:0; background:var(--page); color:var(--ink); font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1080px; margin:0 auto; padding:32px 16px 64px; }
h1 { font-size:26px; line-height:1.25; margin:0 0 6px; }
h2 { font-size:19px; margin:36px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--grid); }
h3 { font-size:15px; margin:0 0 8px; }
.meta { color:var(--ink-2); font-size:14px; }
.card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px; }
.grid { display:grid; gap:12px; }
.kpis { grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
.kpi .label { font-size:13px; color:var(--ink-2); }
.kpi .value { font-size:28px; font-weight:700; }
.kpi .hint { font-size:12px; color:var(--muted); }
.two { grid-template-columns:repeat(2,minmax(0,1fr)); }
@media (max-width:760px) { .two { grid-template-columns:1fr; } }
table { width:100%; border-collapse:collapse; font-size:14px; }
th { text-align:left; font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:var(--ink-2); }
th, td { padding:8px; border-bottom:1px solid var(--grid); vertical-align:top; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.table-wrap { overflow-x:auto; }
.pill { display:inline-flex; align-items:center; gap:6px; padding:1px 9px; border-radius:999px; border:1px solid var(--border); font-size:12px; font-weight:600; white-space:nowrap; }
.pill::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--c,var(--muted)); }
.sev-Critical { --c:var(--critical); } .sev-Major { --c:var(--major); } .sev-Minor { --c:var(--minor); }
.st-Open { --c:var(--accent); } .st-In-Progress { --c:#9085e9; } .st-Resolved { --c:var(--good); }
.flaky-tag { --c:var(--flaky); } .ok-tag { --c:var(--good); } .fail-tag { --c:var(--critical); }
.barlist-row { display:grid; grid-template-columns:90px 1fr 36px; gap:10px; align-items:center; margin:8px 0; font-size:14px; }
.barlist-track { height:14px; background:var(--grid); border-radius:4px; overflow:hidden; }
.barlist-fill { display:block; height:100%; background:var(--accent); border-radius:0 4px 4px 0; }
.barlist-fill.sev-Critical { background:var(--critical); } .barlist-fill.sev-Major { background:var(--major); } .barlist-fill.sev-Minor { background:var(--minor); }
.barlist-value { text-align:right; font-variant-numeric:tabular-nums; }
.trend { width:100%; height:auto; }
.trend .grid { stroke:var(--grid); stroke-width:1; }
.trend .tick { fill:var(--muted); font-size:11px; }
.seg-Critical { fill:var(--critical); } .seg-Major { fill:var(--major); } .seg-Minor { fill:var(--minor); }
.trend rect { stroke:var(--surface); stroke-width:2; }
.legend { display:flex; gap:14px; font-size:13px; color:var(--ink-2); flex-wrap:wrap; }
.legend span::before { content:""; display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; background:var(--c); }
.pipeline { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:14px; }
.pipeline .stage { padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.pipeline .arrow { color:var(--muted); }
.history { font-family:ui-monospace,Menlo,monospace; letter-spacing:2px; }
.history .P { color:var(--good-text); } .history .F { color:var(--critical); font-weight:700; }
pre { background:var(--code); padding:10px; border-radius:8px; white-space:pre-wrap; word-break:break-word; font-size:12.5px; margin:8px 0 0; }
.bug { margin-bottom:14px; page-break-inside:avoid; }
.bug-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.bug-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); gap:14px; margin-top:10px; }
@media (max-width:760px) { .bug-grid { grid-template-columns:1fr; } }
.bug img { width:100%; border:1px solid var(--border); border-radius:8px; }
dl { display:grid; grid-template-columns:auto 1fr; gap:4px 12px; margin:0; font-size:13.5px; }
dt { color:var(--ink-2); } dd { margin:0; word-break:break-word; }
.note { font-size:13px; color:var(--ink-2); }
@media print { body { background:#fff; } h2 { page-break-after:avoid; } .card { break-inside:avoid; } }
</style>
</head>
<body>
<main>
  <h1>Automated Bug Reporting and Severity Classification Using Machine Learning and Playwright Test Automation</h1>
  <p class="meta">Execution report · generated ${esc(timestamp())} · Playwright ${esc(pwVersion)} · Chromium · Node.js ${esc(process.versions.node)}</p>

  <h2>1. Summary</h2>
  <div class="grid kpis">
    <div class="card kpi"><div class="label">Test runs</div><div class="value">${runs.length}</div><div class="hint">${executions} test executions</div></div>
    <div class="card kpi"><div class="label">Overall pass rate</div><div class="value">${executions ? Math.round((passedExecutions / executions) * 100) : 0}%</div><div class="hint">${passedExecutions} passed / ${executions - passedExecutions} failed</div></div>
    <div class="card kpi"><div class="label">Unique bugs logged</div><div class="value">${counts.totalBugs}</div><div class="hint">automatically, 0 manual reports</div></div>
    <div class="card kpi"><div class="label">${sevPill('Critical')}</div><div class="value">${severity[0].n}</div><div class="hint">${criticalBugs.filter((b) => b.alert_sent).length ? `${criticalBugs.filter((b) => b.alert_sent).length} email alert(s) sent` : 'alert previews saved (email not configured)'}</div></div>
    <div class="card kpi"><div class="label">Flaky tests</div><div class="value">${flaky.length}</div><div class="hint">of ${stability.length} tests analysed</div></div>
  </div>
  ${simulated ? `<p class="note">Note: ${simulated} bug(s) in this report are <b>simulated history</b> (npm run seed:history), not from real test runs.</p>` : ''}

  <h2>2. Pipeline</h2>
  <div class="pipeline">
    <span class="stage">Playwright test execution</span><span class="arrow">→</span>
    <span class="stage">Failure detection (custom reporter)</span><span class="arrow">→</span>
    <span class="stage">ML severity prediction (Naive Bayes)</span><span class="arrow">→</span>
    <span class="stage">SQLite storage</span><span class="arrow">→</span>
    <span class="stage">Dashboard &amp; this report</span>
  </div>
  <p class="note">Critical bugs trigger an email alert; results of all runs feed the flaky-test detector.</p>

  <h2>3. Test run summaries</h2>
  <div class="card table-wrap"><table>
    <tr><th>Run</th><th>Started</th><th>Result</th><th class="num">Tests</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Pass rate</th><th class="num">New bugs</th><th class="num">Duration</th></tr>
    ${runs.map((r) => `<tr><td>#${r.id}</td><td>${esc(r.started_at)}</td><td><span class="pill ${r.status === 'passed' ? 'ok-tag' : 'fail-tag'}">${esc(r.status)}</span></td>
      <td class="num">${r.total}</td><td class="num">${r.passed}</td><td class="num">${r.failed}</td>
      <td class="num">${r.total ? Math.round((r.passed / r.total) * 100) : 0}%</td><td class="num">${r.new_bugs}</td><td class="num">${(r.duration_ms / 1000).toFixed(1)}s</td></tr>`).join('')}
  </table></div>

  <h2>4. Defect analytics</h2>
  <div class="grid two">
    <div class="card"><h3>Bugs per module</h3>${barList(bugsPerModule().map((m) => ({ label: m.module, value: m.count })))}</div>
    <div class="card"><h3>Severity distribution (ML predicted)</h3>${barList(severity.map((x) => ({ label: x.s, value: x.n, cls: `sev-${x.s}` })))}</div>
  </div>
  <div class="card" style="margin-top:12px">
    <h3>Bug trend - last 14 days (new bugs per day)</h3>
    <div class="legend"><span style="--c:var(--critical)">Critical</span><span style="--c:var(--major)">Major</span><span style="--c:var(--minor)">Minor</span></div>
    ${trendSvg(trend)}
  </div>

  <h2>5. Bug register</h2>
  <div class="card table-wrap"><table>
    <tr><th>ID</th><th>Module</th><th>Test</th><th>Severity</th><th class="num">Confidence</th><th>Status</th><th>First detected</th><th class="num">Seen</th></tr>
    ${bugs.map((b) => `<tr><td>#${b.id}</td><td>${esc(b.module)}</td><td>${esc(b.title)}${flakyKeys.has(b.test_key) ? ' <span class="pill flaky-tag">Flaky</span>' : ''}</td>
      <td>${sevPill(b.severity)}</td><td class="num">${pct(b.confidence)}</td><td>${statusPill(b.status)}</td><td>${esc(b.created_at)}</td><td class="num">${b.occurrences}×</td></tr>`).join('')}
  </table></div>

  <h2>6. Flaky test analysis</h2>
  <p class="note">A test is flaky when it both passed and failed within the last ${config.flaky.windowRuns} runs (minimum ${config.flaky.minRuns}). History: P = passed, F = failed, oldest → newest.</p>
  <div class="card table-wrap"><table>
    <tr><th>Test</th><th>Module</th><th>Verdict</th><th class="num">Runs</th><th class="num">Failure rate</th><th class="num">Flip rate</th><th>History</th></tr>
    ${stability.map((s) => `<tr><td>${esc(s.title)}</td><td>${esc(s.module)}</td>
      <td><span class="pill ${s.verdict === 'Flaky' ? 'flaky-tag' : s.verdict === 'Stable' ? 'ok-tag' : s.verdict === 'Consistently failing' ? 'fail-tag' : ''}">${s.verdict}</span></td>
      <td class="num">${s.runs}</td><td class="num">${Math.round(s.failureRate * 100)}%</td><td class="num">${Math.round(s.flipRate * 100)}%</td>
      <td class="history">${s.history.split('').map((c) => `<span class="${c}">${c}</span>`).join('')}</td></tr>`).join('')}
  </table></div>

  <h2>7. ML severity model evaluation</h2>
  ${model ? `
  <p class="note">${esc(model.algorithm)} · trained on ${model.trainingSamples} labelled error messages · ${model.model.vocabulary.length} features</p>
  <div class="grid kpis">
    <div class="card kpi"><div class="label">Hold-out accuracy</div><div class="value">${pct(model.metrics.holdOutAccuracy)}</div><div class="hint">stratified 80/20 split${model.metrics.holdOutSamples ? `, ${model.metrics.holdOutSamples} test samples` : ''}</div></div>
    <div class="card kpi"><div class="label">5-fold cross-validation</div><div class="value">${pct(model.metrics.crossValidationAccuracy)}</div><div class="hint">mean accuracy</div></div>
  </div>
  <div class="grid two" style="margin-top:12px">
    <div class="card table-wrap"><h3>Per-class metrics (hold-out)</h3><table>
      <tr><th>Class</th><th class="num">Precision</th><th class="num">Recall</th><th class="num">F1</th><th class="num">Support</th></tr>
      ${SEVERITIES.map((c) => { const m = model.metrics.perClass[c]; return `<tr><td>${sevPill(c)}</td><td class="num">${pct(m.precision)}</td><td class="num">${pct(m.recall)}</td><td class="num">${pct(m.f1)}</td><td class="num">${m.support}</td></tr>`; }).join('')}
    </table></div>
    ${model.metrics.confusionMatrix ? `<div class="card table-wrap"><h3>Confusion matrix (rows = actual, columns = predicted)</h3><table>
      <tr><th></th>${SEVERITIES.map((p) => `<th class="num">${p}</th>`).join('')}</tr>
      ${SEVERITIES.map((a) => `<tr><td><b>${a}</b></td>${SEVERITIES.map((p) => `<td class="num" style="${a === p ? 'font-weight:700' : ''}">${model.metrics.confusionMatrix[a][p]}</td>`).join('')}</tr>`).join('')}
    </table></div>` : ''}
  </div>` : '<p>Model not trained yet.</p>'}

  <h2>8. Critical bug email alerts</h2>
  <div class="card table-wrap">${criticalBugs.length ? `<table>
    <tr><th>Bug</th><th>Module</th><th>Test</th><th>Detected</th><th>Alert</th></tr>
    ${criticalBugs.map((b) => `<tr><td>#${b.id}</td><td>${esc(b.module)}</td><td>${esc(b.title)}</td><td>${esc(b.created_at)}</td>
      <td>${b.alert_sent ? 'Email sent' : b.file === 'simulated-history' ? 'Simulated' : fs.existsSync(path.join(config.alertPreviewDir, `critical-bug-${b.id}.html`)) ? `Preview saved: reports/alerts/critical-bug-${b.id}.html` : 'Not sent'}</td></tr>`).join('')}
  </table>` : '<p>No Critical bugs detected.</p>'}</div>

  <h2>9. Defect details</h2>
  ${bugs.filter((b) => b.file !== 'simulated-history').map((b) => {
    const img = screenshotDataUri(b);
    return `<div class="card bug">
      <div class="bug-head"><b>#${b.id}</b> ${sevPill(b.severity)} ${statusPill(b.status)} ${flakyKeys.has(b.test_key) ? '<span class="pill flaky-tag">Flaky</span>' : ''} <b>${esc(b.title)}</b></div>
      <div class="bug-grid">
        <div>
          <dl>
            <dt>Module</dt><dd>${esc(b.module)}</dd>
            <dt>Test</dt><dd>${esc(b.test_key)}</dd>
            <dt>File</dt><dd>${esc(b.file)}</dd>
            <dt>Timestamp</dt><dd>${esc(b.created_at)} (last seen ${esc(b.last_seen_at)})</dd>
            <dt>Occurrences</dt><dd>${b.occurrences} run(s)</dd>
            <dt>ML prediction</dt><dd>${b.severity}, ${pct(b.confidence)} confidence</dd>
          </dl>
          <pre>${esc(b.error_message)}</pre>
        </div>
        <div>${img ? `<img src="${img}" alt="Screenshot of the page when test '${esc(b.title)}' failed">` : '<p class="note">No screenshot.</p>'}</div>
      </div>
    </div>`;
  }).join('')}

  <p class="note" style="margin-top:32px">Source data: data/bugs.db · Interactive dashboard: npm run dashboard · Playwright HTML report: reports/playwright-html/index.html</p>
</main>
</body>
</html>`;

  fs.writeFileSync(OUTPUT, html);
  console.log(`Report written to ${path.relative(process.cwd(), OUTPUT)} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
}

main();
