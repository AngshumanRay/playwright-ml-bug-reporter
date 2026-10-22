/**
 * Critical bug email alert (Objective 7).
 *
 * Rule: when a test run ends and ANY Critical bug was detected in it (new or seen again),
 * ONE email is sent to everyone in ALERT_TO with every Critical bug's details and a clear
 * screenshot of the page at the moment of failure. A run without Critical bugs sends no email.
 * The pipeline (several runs) sends one email at the end covering all its runs, with the
 * HTML report attached.
 *
 * Without SMTP settings the email is saved to reports/alerts/critical-alert-run-<run>.html.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { Bug, bugsSeenInRuns, getRuns, markAlertSent, timestamp } from '../db/database';
import { deliverEmail, DeliveryResult, EmailAttachment, escapeHtml as esc } from './emailNotifier';

const C = { navy: '#10243f', ink: '#1f2328', muted: '#5b6472', line: '#e3e7ed', panel: '#f1f4f8', critical: '#d03b3b' };

function kpi(label: string, value: string | number, color = C.navy) {
  return `<td style="padding:12px;background:${C.panel};border-radius:8px;width:25%">
    <div style="font-size:26px;font-weight:bold;color:${color}">${value}</div>
    <div style="font-size:12px;color:${C.muted}">${label}</div></td>`;
}

function buildEmail(runIds: number[], imageSrc: (bug: Bug) => string | null, reportAttached: boolean) {
  const runs = getRuns(runIds);
  const seen = bugsSeenInRuns(runIds);
  const critical = seen.filter((b) => b.severity === 'Critical');
  const others = seen.filter((b) => b.severity !== 'Critical');
  const executed = runs.reduce((n, r) => n + r.total, 0);
  const failed = runs.reduce((n, r) => n + r.failed, 0);
  const newCritical = critical.filter((b) => runIds.includes(b.first_run_id));
  const modules = [...new Set(critical.map((b) => b.module))].join(', ');
  const runLabel = runs.length === 1 ? `test run #${runs[0].id}` : `test runs #${runs[0]?.id}–#${runs[runs.length - 1]?.id}`;
  const dashboard = `http://localhost:${config.dashboardPort}`;

  const subject = `🚨 CRITICAL: ${critical.length} Critical bug(s) detected in ${runLabel} (${modules})`;

  const rows = critical.map((b, i) => `<tr style="background:${i % 2 ? C.panel : '#ffffff'}">
      <td style="padding:8px;font-size:13px">#${b.id}</td>
      <td style="padding:8px;font-size:13px">${esc(b.module)}</td>
      <td style="padding:8px;font-size:13px;word-break:break-word">${esc(b.title)}</td>
      <td style="padding:8px;font-size:13px">${runIds.includes(b.first_run_id) ? '<b>New</b>' : 'Known'}</td>
      <td style="padding:8px;font-size:13px;text-align:center">${b.seen_in_runs}/${runs.length}</td>
    </tr>`).join('');

  const details = critical.map((b) => {
    const src = imageSrc(b);
    return `<div style="margin:0 0 26px;padding:16px;border:1px solid ${C.line};border-radius:8px">
      <div style="font-size:16px;font-weight:bold;color:${C.critical};word-break:break-word">#${b.id} · ${esc(b.module)}: ${esc(b.title)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin:10px 0;table-layout:fixed">
        <col width="90"><col>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">Test</td><td style="word-break:break-word">${esc(b.test_key)}</td></tr>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">File</td><td style="word-break:break-word">${esc(b.file)}</td></tr>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">Detected</td><td style="word-break:break-word">${esc(b.last_seen_at)} (first: ${esc(b.created_at)})</td></tr>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">Browser</td><td style="word-break:break-word">${esc(b.browser)}</td></tr>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">ML severity</td><td style="word-break:break-word">Critical, ${(b.confidence * 100).toFixed(1)}% confidence</td></tr>
        <tr><td style="color:${C.muted};padding:2px 10px 2px 0;vertical-align:top">Dashboard</td><td style="word-break:break-word"><a href="${dashboard}/bugs/${b.id}">${dashboard}/bugs/${b.id}</a></td></tr>
      </table>
      <pre style="background:${C.panel};padding:10px;border-radius:6px;white-space:pre-wrap;word-break:break-word;font-size:12px;margin:0 0 12px">${esc(b.error_message)}</pre>
      ${src ? `<img src="${src}" width="600" alt="Screenshot when '${esc(b.title)}' failed" style="width:100%;max-width:600px;border:1px solid ${C.line};border-radius:6px">` : '<i style="color:#888">No screenshot</i>'}
    </div>`;
  }).join('');

  const html = `
<div style="background:#f6f7f9;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
  <tr><td style="background:${C.navy};padding:20px 24px;color:#ffffff">
    <div style="font-size:12px;letter-spacing:1px;color:#cadcfc">AUTOMATED BUG REPORTING</div>
    <div style="font-size:22px;font-weight:bold;margin-top:4px">Critical bug alert</div>
    <div style="font-size:13px;color:#cadcfc;margin-top:4px">${esc(runLabel[0].toUpperCase() + runLabel.slice(1))} · finished ${esc(runs[runs.length - 1]?.finished_at ?? timestamp())}</div>
  </td></tr>
  <tr><td style="padding:14px 24px;background:${C.critical};color:#ffffff;font-size:16px;font-weight:bold">
    ${critical.length} Critical bug(s) detected: ${esc(modules)}
  </td></tr>
  <tr><td style="padding:20px 24px 4px">
    <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>
      ${kpi('Tests executed', executed)}${kpi('Failed', failed, C.critical)}${kpi('Critical bugs', critical.length, C.critical)}${kpi('New Critical', newCritical.length)}
    </tr></table>
    <div style="font-size:13px;color:${C.muted};padding:4px 8px 0">Also in this run: ${others.filter((b) => b.severity === 'Major').length} Major and
      ${others.filter((b) => b.severity === 'Minor').length} Minor bug(s), listed in the dashboard${reportAttached ? ' and the attached report' : ''}.</div>
  </td></tr>
  <tr><td style="padding:18px 24px 0">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr style="background:${C.navy};color:#ffffff;font-size:12px;text-align:left">
        <th style="padding:8px">ID</th><th style="padding:8px">Module</th><th style="padding:8px">Critical bug</th>
        <th style="padding:8px">Status</th><th style="padding:8px">Failed in</th></tr>
      ${rows}
    </table>
  </td></tr>
  <tr><td style="padding:22px 24px 0">
    <div style="font-size:17px;font-weight:bold;color:${C.navy};margin-bottom:12px">Details and snapshots at the moment of failure</div>
    ${details}
  </td></tr>
  <tr><td style="padding:16px 24px 22px;font-size:12px;color:${C.muted};border-top:1px solid ${C.line}">
    ${reportAttached ? 'The full HTML report of all bugs is attached (bug-report.html). ' : ''}Interactive dashboard: <a href="${dashboard}">${dashboard}</a> (run <code>npm run dashboard</code> on the test machine).
  </td></tr>
</table></div>`;

  return { subject, html, critical, runs };
}

/** Sends the Critical bug alert for these runs; returns null when no Critical bug was detected. */
export async function sendCriticalAlert(runIds: number[], options: { reportPath?: string } = {}): Promise<DeliveryResult | null> {
  const reportAttached = !!options.reportPath && fs.existsSync(options.reportPath);
  const shot = (b: Bug) => {
    const p = b.screenshot_path ? path.join(config.screenshotDir, b.screenshot_path) : null;
    return p && fs.existsSync(p) ? p : null;
  };

  // Email: screenshots are attachments referenced by content id, so mail clients show them inline
  const email = buildEmail(runIds, (b) => (shot(b) ? `cid:bug-${b.id}` : null), reportAttached);
  if (!email.critical.length) return null;
  // Preview file: the same email with the screenshots embedded directly
  const preview = buildEmail(runIds, (b) => (shot(b) ? `data:image/png;base64,${fs.readFileSync(shot(b)!).toString('base64')}` : null), reportAttached);

  const attachments: EmailAttachment[] = email.critical
    .filter((b) => shot(b))
    .map((b) => ({ filename: `critical-bug-${b.id}.png`, path: shot(b)!, cid: `bug-${b.id}` }));
  if (reportAttached) attachments.push({ filename: 'bug-report.html', path: options.reportPath! });

  const result = await deliverEmail({
    subject: email.subject,
    html: email.html,
    previewHtml: preview.html,
    attachments,
    previewFile: `critical-alert-run-${email.runs[email.runs.length - 1]?.id ?? 0}.html`,
    label: `Critical bug email (${email.critical.length} Critical bug(s))`,
  });
  if (result.sent) email.critical.forEach((b) => markAlertSent(b.id));
  return result;
}
