/**
 * Email delivery used by the Critical bug alert (criticalAlertEmail.ts).
 *
 * - ALERTS_ENABLED=true + SMTP settings in .env -> the email is sent with Nodemailer.
 * - Otherwise the exact same email is saved as an HTML preview in reports/alerts/,
 *   so the feature can be demonstrated without an email account.
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config';

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface EmailAttachment {
  filename: string;
  path: string;
  cid?: string; // set for images shown inside the email body
}

export interface DeliveryResult {
  sent: boolean;
  detail: string;
}

/** True when .env has everything needed to send real emails. */
export function isEmailConfigured(): boolean {
  const a = config.alerts;
  return a.enabled && !!a.smtpUser && !!a.smtpPassword;
}

/**
 * Sends an email to everyone in ALERT_TO, or - when email is not configured - saves the same
 * email as an HTML file in reports/alerts/ (previewHtml can embed images directly for that file).
 */
export async function deliverEmail(email: {
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  previewFile: string;
  previewHtml?: string;
  label: string;
  to?: string[]; // default: ALERT_TO from .env
}): Promise<DeliveryResult> {
  const a = config.alerts;
  const to = email.to ?? a.to;
  if (isEmailConfigured() && to.length) {
    try {
      const transporter = nodemailer.createTransport({
        host: a.smtpHost,
        port: a.smtpPort,
        secure: a.smtpPort === 465,
        auth: { user: a.smtpUser, pass: a.smtpPassword },
      });
      await transporter.sendMail({
        from: a.from,
        to: to.join(', '),
        subject: email.subject,
        html: email.html,
        attachments: (email.attachments ?? []).filter((f) => fs.existsSync(f.path)),
      });
      return { sent: true, detail: `${email.label} sent to ${to.join(', ')}` };
    } catch (err) {
      return { sent: false, detail: `${email.label} FAILED: ${(err as Error).message}` };
    }
  }

  fs.mkdirSync(config.alertPreviewDir, { recursive: true });
  const file = path.join(config.alertPreviewDir, email.previewFile);
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${escapeHtml(email.subject)}</title>${email.previewHtml ?? email.html}`);
  return { sent: false, detail: `Email disabled - ${email.label} saved to ${path.relative(process.cwd(), file)}` };
}
