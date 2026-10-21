/**
 * Email alert for Critical bugs (Objective 7).
 *
 * - ALERTS_ENABLED=true + SMTP settings in .env -> the email is sent with Nodemailer.
 * - Otherwise the exact same email is saved as an HTML preview in reports/alerts/,
 *   so the feature can be demonstrated without an email account.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config';
import type { Bug } from '../db/database';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildAlertEmail(bug: Bug) {
  const dashboardUrl = `http://localhost:${config.dashboardPort}/bugs/${bug.id}`;
  const subject = `[CRITICAL BUG #${bug.id}] ${bug.module}: ${bug.title}`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="color:#b91c1c;margin-bottom:4px">Critical bug detected by automated tests</h2>
    <p style="color:#555;margin-top:0">Severity predicted by the ML model with ${(bug.confidence * 100).toFixed(1)}% confidence</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
      <tr><td><b>Bug ID</b></td><td>#${bug.id}</td></tr>
      <tr><td><b>Module</b></td><td>${escapeHtml(bug.module)}</td></tr>
      <tr><td><b>Test</b></td><td>${escapeHtml(bug.test_key)}</td></tr>
      <tr><td><b>Detected at</b></td><td>${bug.created_at}</td></tr>
      <tr><td><b>Browser</b></td><td>${escapeHtml(bug.browser)}</td></tr>
      <tr><td><b>Test file</b></td><td>${escapeHtml(bug.file)}</td></tr>
    </table>
    <h3>Error message</h3>
    <pre style="background:#f4f4f5;padding:12px;white-space:pre-wrap;font-size:13px">${escapeHtml(bug.error_message)}</pre>
    <p><a href="${dashboardUrl}">Open bug #${bug.id} in the dashboard</a></p>
  </div>`;
  return { subject, html };
}

export async function sendCriticalBugAlert(bug: Bug): Promise<{ sent: boolean; detail: string }> {
  const { subject, html } = buildAlertEmail(bug);
  const a = config.alerts;

  if (a.enabled && a.smtpUser && a.smtpPassword && a.to.length) {
    try {
      const transporter = nodemailer.createTransport({
        host: a.smtpHost,
        port: a.smtpPort,
        secure: a.smtpPort === 465,
        auth: { user: a.smtpUser, pass: a.smtpPassword },
      });
      const screenshot = bug.screenshot_path ? path.join(config.screenshotDir, bug.screenshot_path) : null;
      await transporter.sendMail({
        from: a.from,
        to: a.to.join(', '),
        subject,
        html,
        attachments: screenshot && fs.existsSync(screenshot) ? [{ filename: 'screenshot.png', path: screenshot }] : [],
      });
      return { sent: true, detail: `Email alert for Critical bug #${bug.id} sent to ${a.to.join(', ')}` };
    } catch (err) {
      return { sent: false, detail: `Email alert for bug #${bug.id} FAILED: ${(err as Error).message}` };
    }
  }

  fs.mkdirSync(config.alertPreviewDir, { recursive: true });
  const file = path.join(config.alertPreviewDir, `critical-bug-${bug.id}.html`);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${escapeHtml(subject)}</title>${html}`);
  return {
    sent: false,
    detail: `Email alerts disabled - Critical bug #${bug.id} alert saved to ${path.relative(process.cwd(), file)}`,
  };
}
