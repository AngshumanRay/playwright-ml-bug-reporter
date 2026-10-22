/**
 * Run report email: sent to the email ID(s) entered in the Test Runner when a run finishes.
 *
 * Shows the result, the numbers, the Critical bugs, and every failed test with its ML severity
 * and a screenshot shown inside the email. The full report is attached as a self-contained
 * HTML file, and a button opens it in the dashboard.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { getRunReport, RunReport } from '../runner/runReport';
import { deliverEmail, DeliveryResult, EmailAttachment, escapeHtml as esc } from './emailNotifier';

const C = { navy: '#10243f', ink: '#1f2328', muted: '#5b6472', line: '#e3e7ed', panel: '#f1f4f8', pass: '#1b8e4e', fail: '#d03b3b', blue: '#2a78d6' };
const SEV: Record<string, string> = { Critical: '#d03b3b', Major: '#ec835a', Minor: '#f2a900' };

const pill = (text: string, color: string) =>
  `<span style="display:inline-block;padding:2px 10px;border-radius:12px;background:${color};color:#fff;font-size:12px;font-weight:bold">${esc(text)}</span>`;

function kpi(label: string, value: string | number, color = C.navy) {
  return `<td style="padding:12px;background:${C.panel};border-radius:8px;width:25%">
    <div style="font-size:26px;font-weight:bold;color:${color}">${value}</div>
    <div style="font-size:12px;color:${C.muted}">${label}</div></td>`;
}

function shortError(message: string | null): string {
  const lines = (message ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const expected = lines.find((l) => l.startsWith('Expected:'));
  const received = lines.find((l) => l.startsWith('Received:'));
  return [lines[0]?.replace(/^Error:\s*/, ''), expected, received].filter(Boolean).join('\n');
}

function buildHtml(r: RunReport, imageSrc: (file: string | null, id: number) => string | null, attached: boolean) {
  const url = `${config.dashboardUrl}/runs/${r.run.id}`;
  const ok = r.passedRun;
  const banner = r.run.status === 'stopped' ? { color: C.muted, text: 'Run stopped before it finished' }
    : ok ? { color: C.pass, text: `All ${r.total} tests passed` }
    : { color: C.fail, text: `${r.failed} of ${r.total} tests failed${r.criticalBugs.length ? ` · ${r.criticalBugs.length} Critical bug(s)` : ''}` };

  const failedTests = r.results.filter((t) => t.status === 'failed');
  const rows = failedTests.map((t, i) => `<tr style="background:${i % 2 ? C.panel : '#ffffff'}">
      <td style="padding:8px;font-size:13px">${esc(t.module)}</td>
      <td style="padding:8px;font-size:13px;word-break:break-word">${esc(t.title)}</td>
      <td style="padding:8px">${t.severity ? pill(t.severity, SEV[t.severity]) : ''}</td>
    </tr>`).join('');

  const snapshots = failedTests.map((t) => {
    const src = imageSrc(t.screenshot_path, t.id);
    return `<div style="margin:0 0 22px;padding:14px;border:1px solid ${C.line};border-radius:8px">
      <div style="font-size:14px;margin-bottom:6px">${t.severity ? pill(t.severity, SEV[t.severity]) : ''}
        <b style="color:${C.ink};word-break:break-word">&nbsp;${esc(t.module)}: ${esc(t.title)}</b></div>
      <div style="font-family:Courier New,monospace;font-size:12px;color:${C.muted};white-space:pre-wrap;word-break:break-word;margin-bottom:8px">${esc(shortError(t.error_message))}</div>
      ${src ? `<img src="${src}" width="600" alt="Screenshot when '${esc(t.title)}' failed" style="width:100%;max-width:600px;border:1px solid ${C.line};border-radius:6px">` : ''}
    </div>`;
  }).join('');

  const critical = r.criticalBugs.length ? `<tr><td style="padding:16px 24px 0">
    <div style="border:1px solid ${C.fail};background:#fdf0f0;border-radius:8px;padding:12px 14px">
      <div style="font-weight:bold;color:${C.fail};margin-bottom:4px">${r.criticalBugs.length} Critical bug(s) need attention</div>
      ${r.criticalBugs.map((b) => `<div style="font-size:13px;color:${C.ink};word-break:break-word">#${b.id} · ${esc(b.module)}: ${esc(b.title)}</div>`).join('')}
    </div></td></tr>` : '';

  const html = `
<div style="background:#f6f7f9;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
  <tr><td style="background:${C.navy};padding:20px 24px;color:#ffffff">
    <div style="font-size:12px;letter-spacing:1px;color:#cadcfc">AUTOMATED BUG REPORTING · TEST RUN REPORT</div>
    <div style="font-size:21px;font-weight:bold;margin-top:4px;word-break:break-word">${esc(r.name)}</div>
    <div style="font-size:13px;color:#cadcfc;margin-top:4px">${esc(r.suiteName)} suite · ${esc(r.duration)} · started from ${esc(r.trigger)}</div>
  </td></tr>
  <tr><td style="padding:14px 24px;background:${banner.color};color:#ffffff;font-size:16px;font-weight:bold">${esc(banner.text)}</td></tr>
  <tr><td style="padding:20px 24px 4px">
    <table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>
      ${kpi('Tests', r.total)}${kpi('Passed', r.passed, C.pass)}${kpi('Failed', r.failed, r.failed ? C.fail : C.navy)}${kpi('Pass rate', `${r.passRate}%`)}
    </tr></table>
    <div style="font-size:13px;color:${C.muted};padding:4px 8px 0">Bugs found (ML severity):
      ${r.severityCounts.map((s) => pill(`${s.severity} ${s.count}`, SEV[s.severity])).join(' ')}</div>
  </td></tr>
  ${critical}
  <tr><td style="padding:18px 24px 0" align="center">
    <a href="${url}" style="display:inline-block;background:${C.blue};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Open the full report</a>
    <div style="font-size:12px;color:${C.muted};margin-top:6px">${attached ? 'The full report is also attached to this email.' : ''}</div>
  </td></tr>
  ${failedTests.length ? `<tr><td style="padding:18px 24px 0">
    <div style="font-size:17px;font-weight:bold;color:${C.navy};margin-bottom:8px">Failed tests</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr style="background:${C.navy};color:#ffffff;font-size:12px;text-align:left">
        <th style="padding:8px">Module</th><th style="padding:8px">Test</th><th style="padding:8px">Severity</th></tr>
      ${rows}
    </table></td></tr>
  <tr><td style="padding:22px 24px 0">
    <div style="font-size:17px;font-weight:bold;color:${C.navy};margin-bottom:12px">Snapshots at the moment of failure</div>
    ${snapshots}
  </td></tr>` : ''}
  <tr><td style="padding:16px 24px 22px;font-size:12px;color:${C.muted};border-top:1px solid ${C.line}">
    Sent automatically by the Automated Bug Reporting Test Runner.
  </td></tr>
</table></div>`;

  const subject = `${r.run.status === 'stopped' ? '⏹ STOPPED' : ok ? '✅ PASSED' : '❌ FAILED'} · ${r.name} · ${r.passed}/${r.total} passed` +
    (r.criticalBugs.length ? ` · ${r.criticalBugs.length} Critical` : '');
  return { subject, html };
}

export async function sendRunReport(runId: number, recipients: string[], reportFile: string | null): Promise<DeliveryResult | null> {
  const r = getRunReport(runId);
  if (!r) return null;
  const shot = (file: string | null) => {
    const p = file ? path.join(config.screenshotDir, file) : null;
    return p && fs.existsSync(p) ? p : null;
  };
  const attached = !!reportFile && fs.existsSync(reportFile);
  const email = buildHtml(r, (file, id) => (shot(file) ? `cid:test-${id}` : null), attached);
  const preview = buildHtml(r, (file) => (shot(file) ? `data:image/png;base64,${fs.readFileSync(shot(file)!).toString('base64')}` : null), attached);

  const attachments: EmailAttachment[] = r.results
    .filter((t) => t.status === 'failed' && shot(t.screenshot_path))
    .map((t) => ({ filename: `test-${t.id}.png`, path: shot(t.screenshot_path)!, cid: `test-${t.id}` }));
  if (attached) attachments.push({ filename: path.basename(reportFile!), path: reportFile! });

  return deliverEmail({
    subject: email.subject,
    html: email.html,
    previewHtml: preview.html,
    attachments,
    to: recipients,
    previewFile: `run-report-${r.slug}.html`,
    label: `Run report email for ${r.name}`,
  });
}
