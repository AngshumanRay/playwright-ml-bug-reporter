/**
 * Centralized SQLite storage for test runs, individual test results and bugs (Objective 3).
 *
 * Tables
 *  - test_runs     one row per Playwright execution (run summary)
 *  - test_results  one row per test per run (pass/fail history -> flaky detection)
 *  - bugs          one row per unique defect (deduplicated by fingerprint)
 *  - bug_history   every status change of a bug (traceability / audit trail)
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, BugStatus, Severity } from '../config';

export interface TestRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  new_bugs: number;
}

export interface TestResultRow {
  id: number;
  run_id: number;
  test_key: string;
  title: string;
  module: string;
  file: string;
  status: string;
  duration_ms: number;
  error_message: string | null;
  executed_at: string;
}

export interface Bug {
  id: number;
  fingerprint: string;
  first_run_id: number;
  last_run_id: number;
  test_key: string;
  title: string;
  module: string;
  file: string;
  browser: string;
  error_message: string;
  error_stack: string | null;
  screenshot_path: string | null;
  severity: Severity;
  confidence: number;
  status: BugStatus;
  occurrences: number;
  alert_sent: number;
  created_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface BugHistory {
  id: number;
  bug_id: number;
  old_status: string | null;
  new_status: string;
  changed_at: string;
}

/** Local timestamp in "YYYY-MM-DD HH:MM:SS" format (sortable and readable). */
export function timestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  return db;
}

function createSchema(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT NOT NULL DEFAULT 'running',
      total        INTEGER NOT NULL DEFAULT 0,
      passed       INTEGER NOT NULL DEFAULT 0,
      failed       INTEGER NOT NULL DEFAULT 0,
      skipped      INTEGER NOT NULL DEFAULT 0,
      duration_ms  INTEGER NOT NULL DEFAULT 0,
      new_bugs     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id        INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
      test_key      TEXT NOT NULL,
      title         TEXT NOT NULL,
      module        TEXT NOT NULL,
      file          TEXT NOT NULL,
      status        TEXT NOT NULL,
      duration_ms   INTEGER NOT NULL,
      error_message TEXT,
      executed_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_results_test ON test_results(test_key, run_id);

    CREATE TABLE IF NOT EXISTS bugs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint     TEXT NOT NULL,
      first_run_id    INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
      last_run_id     INTEGER NOT NULL,
      test_key        TEXT NOT NULL,
      title           TEXT NOT NULL,
      module          TEXT NOT NULL,
      file            TEXT NOT NULL,
      browser         TEXT NOT NULL,
      error_message   TEXT NOT NULL,
      error_stack     TEXT,
      screenshot_path TEXT,
      severity        TEXT NOT NULL CHECK (severity IN ('Critical','Major','Minor')),
      confidence      REAL NOT NULL,
      status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved')),
      occurrences     INTEGER NOT NULL DEFAULT 1,
      alert_sent      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      last_seen_at    TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bugs_fingerprint ON bugs(fingerprint);

    CREATE TABLE IF NOT EXISTS bug_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bug_id      INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
      old_status  TEXT,
      new_status  TEXT NOT NULL,
      changed_at  TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------- test runs

export function createRun(startedAt: string = timestamp()): number {
  const info = getDb().prepare('INSERT INTO test_runs (started_at) VALUES (?)').run(startedAt);
  return Number(info.lastInsertRowid);
}

export function finishRun(
  runId: number,
  summary: Pick<TestRun, 'status' | 'total' | 'passed' | 'failed' | 'skipped' | 'duration_ms' | 'new_bugs'>,
  finishedAt: string = timestamp(),
): void {
  getDb()
    .prepare(
      `UPDATE test_runs SET finished_at = ?, status = ?, total = ?, passed = ?, failed = ?,
       skipped = ?, duration_ms = ?, new_bugs = ? WHERE id = ?`,
    )
    .run(finishedAt, summary.status, summary.total, summary.passed, summary.failed,
      summary.skipped, summary.duration_ms, summary.new_bugs, runId);
}

export function listRuns(limit = 50): TestRun[] {
  return getDb().prepare('SELECT * FROM test_runs ORDER BY started_at DESC, id DESC LIMIT ?').all(limit) as TestRun[];
}

// ------------------------------------------------------------- test results

export function insertTestResult(row: Omit<TestResultRow, 'id'>): void {
  getDb()
    .prepare(
      `INSERT INTO test_results (run_id, test_key, title, module, file, status, duration_ms, error_message, executed_at)
       VALUES (@run_id, @test_key, @title, @module, @file, @status, @duration_ms, @error_message, @executed_at)`,
    )
    .run(row);
}

/** Results of the last `windowRuns` completed runs, oldest first (input for flaky detection). */
export function recentResults(windowRuns: number): TestResultRow[] {
  return getDb()
    .prepare(
      `SELECT r.* FROM test_results r
       WHERE r.run_id IN (
         SELECT id FROM test_runs
         WHERE status != 'running' AND id IN (SELECT DISTINCT run_id FROM test_results)
         ORDER BY started_at DESC, id DESC LIMIT ?)
       ORDER BY r.executed_at ASC, r.run_id ASC`,
    )
    .all(windowRuns) as TestResultRow[];
}

// --------------------------------------------------------------------- bugs

/** An existing bug with the same fingerprint that is not yet resolved. */
export function findActiveBug(fingerprint: string): Bug | undefined {
  return getDb()
    .prepare(`SELECT * FROM bugs WHERE fingerprint = ? AND status != 'Resolved' ORDER BY id DESC LIMIT 1`)
    .get(fingerprint) as Bug | undefined;
}

export function insertBug(
  bug: Omit<Bug, 'id' | 'status' | 'occurrences' | 'alert_sent' | 'last_seen_at' | 'updated_at' | 'last_run_id'>,
): number {
  const conn = getDb();
  const info = conn
    .prepare(
      `INSERT INTO bugs (fingerprint, first_run_id, last_run_id, test_key, title, module, file, browser,
         error_message, error_stack, screenshot_path, severity, confidence, created_at, last_seen_at, updated_at)
       VALUES (@fingerprint, @first_run_id, @first_run_id, @test_key, @title, @module, @file, @browser,
         @error_message, @error_stack, @screenshot_path, @severity, @confidence, @created_at, @created_at, @created_at)`,
    )
    .run(bug);
  const id = Number(info.lastInsertRowid);
  conn
    .prepare('INSERT INTO bug_history (bug_id, old_status, new_status, changed_at) VALUES (?, NULL, ?, ?)')
    .run(id, 'Open', bug.created_at);
  return id;
}

/** The same defect was seen again: bump the counter and keep the latest evidence. */
export function recordOccurrence(bugId: number, runId: number, screenshotPath: string | null, seenAt: string): void {
  getDb()
    .prepare(
      `UPDATE bugs SET occurrences = occurrences + 1, last_run_id = ?, last_seen_at = ?,
       screenshot_path = COALESCE(?, screenshot_path) WHERE id = ?`,
    )
    .run(runId, seenAt, screenshotPath, bugId);
}

export function markAlertSent(bugId: number): void {
  getDb().prepare('UPDATE bugs SET alert_sent = 1 WHERE id = ?').run(bugId);
}

export function getBug(id: number): Bug | undefined {
  return getDb().prepare('SELECT * FROM bugs WHERE id = ?').get(id) as Bug | undefined;
}

export function getBugHistory(bugId: number): BugHistory[] {
  return getDb().prepare('SELECT * FROM bug_history WHERE bug_id = ? ORDER BY id ASC').all(bugId) as BugHistory[];
}

export function updateBugStatus(bugId: number, newStatus: BugStatus): void {
  const conn = getDb();
  const bug = getBug(bugId);
  if (!bug || bug.status === newStatus) return;
  const now = timestamp();
  conn.transaction(() => {
    conn.prepare('UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, bugId);
    conn
      .prepare('INSERT INTO bug_history (bug_id, old_status, new_status, changed_at) VALUES (?, ?, ?, ?)')
      .run(bugId, bug.status, newStatus, now);
  })();
}

export interface BugFilter {
  severity?: string;
  status?: string;
  module?: string;
  q?: string;
}

export function listBugs(filter: BugFilter = {}): Bug[] {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter.severity) { where.push('severity = @severity'); params.severity = filter.severity; }
  if (filter.status) { where.push('status = @status'); params.status = filter.status; }
  if (filter.module) { where.push('module = @module'); params.module = filter.module; }
  if (filter.q) {
    where.push('(title LIKE @q OR error_message LIKE @q OR CAST(id AS TEXT) = @qExact)');
    params.q = `%${filter.q}%`;
    params.qExact = filter.q.replace(/^#/, '');
  }
  const sql = `SELECT * FROM bugs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`;
  return getDb().prepare(sql).all(params) as Bug[];
}

export function listModules(): string[] {
  return (getDb().prepare('SELECT DISTINCT module FROM bugs ORDER BY module').all() as { module: string }[])
    .map((r) => r.module);
}

// --------------------------------------------------------------- analytics

export function bugsPerModule(): { module: string; count: number }[] {
  return getDb()
    .prepare('SELECT module, COUNT(*) AS count FROM bugs GROUP BY module ORDER BY count DESC')
    .all() as { module: string; count: number }[];
}

export function severityDistribution(): { severity: Severity; count: number }[] {
  return getDb()
    .prepare('SELECT severity, COUNT(*) AS count FROM bugs GROUP BY severity')
    .all() as { severity: Severity; count: number }[];
}

/** New bugs per day for the last `days` days (including today), split by severity. */
export function bugTrend(days = 14): { date: string; Critical: number; Major: number; Minor: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date, severity, COUNT(*) AS count FROM bugs
       WHERE created_at >= ? GROUP BY date, severity`,
    )
    .all(timestamp(daysAgo(days - 1)).slice(0, 10)) as { date: string; severity: Severity; count: number }[];

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = timestamp(daysAgo(i)).slice(0, 10);
    const day = { date, Critical: 0, Major: 0, Minor: 0 };
    for (const r of rows.filter((x) => x.date === date)) day[r.severity] = r.count;
    trend.push(day);
  }
  return trend;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export function overviewCounts() {
  const conn = getDb();
  const one = (sql: string) => (conn.prepare(sql).get() as { c: number }).c;
  return {
    totalBugs: one('SELECT COUNT(*) AS c FROM bugs'),
    openBugs: one(`SELECT COUNT(*) AS c FROM bugs WHERE status = 'Open'`),
    inProgressBugs: one(`SELECT COUNT(*) AS c FROM bugs WHERE status = 'In Progress'`),
    resolvedBugs: one(`SELECT COUNT(*) AS c FROM bugs WHERE status = 'Resolved'`),
    criticalOpen: one(`SELECT COUNT(*) AS c FROM bugs WHERE severity = 'Critical' AND status != 'Resolved'`),
    totalRuns: one(`SELECT COUNT(*) AS c FROM test_runs WHERE status != 'running'`),
  };
}

export function resetDatabase(): void {
  const conn = getDb();
  conn.exec('DELETE FROM bug_history; DELETE FROM bugs; DELETE FROM test_results; DELETE FROM test_runs;');
  conn.exec(`DELETE FROM sqlite_sequence WHERE name IN ('bug_history','bugs','test_results','test_runs');`);
}
