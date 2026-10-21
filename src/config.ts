/**
 * Central configuration. Values can be overridden in a .env file at the project root.
 */
import path from 'node:path';
import dotenv from 'dotenv';

export const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const env = process.env;

export const config = {
  // Storage
  dbPath: path.join(ROOT_DIR, 'data', 'bugs.db'),
  screenshotDir: path.join(ROOT_DIR, 'reports', 'screenshots'),
  alertPreviewDir: path.join(ROOT_DIR, 'reports', 'alerts'),

  // Machine learning
  trainingDataPath: path.join(ROOT_DIR, 'src', 'ml', 'training-data.csv'),
  modelPath: path.join(ROOT_DIR, 'src', 'ml', 'model', 'severity-model.json'),

  // Servers
  demoAppPort: Number(env.DEMO_APP_PORT ?? 4000),
  dashboardPort: Number(env.DASHBOARD_PORT ?? 3000),

  // Email alerts
  alerts: {
    enabled: (env.ALERTS_ENABLED ?? 'false').toLowerCase() === 'true',
    smtpHost: env.SMTP_HOST ?? 'smtp.gmail.com',
    smtpPort: Number(env.SMTP_PORT ?? 587),
    smtpUser: env.SMTP_USER ?? '',
    smtpPassword: env.SMTP_PASSWORD ?? '',
    from: env.ALERT_FROM ?? env.SMTP_USER ?? '',
    to: (env.ALERT_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  // Flaky detection: look at the last N runs; a test needs at least MIN_RUNS results to be judged
  flaky: {
    windowRuns: 10,
    minRuns: 3,
  },
};

export type Severity = 'Critical' | 'Major' | 'Minor';
export const SEVERITIES: Severity[] = ['Critical', 'Major', 'Minor'];

export type BugStatus = 'Open' | 'In Progress' | 'Resolved';
export const BUG_STATUSES: BugStatus[] = ['Open', 'In Progress', 'Resolved'];
