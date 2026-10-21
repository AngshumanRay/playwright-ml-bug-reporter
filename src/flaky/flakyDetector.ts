/**
 * Flaky test detection (Objective 6).
 *
 * A test is FLAKY when, over the last N runs (config.flaky.windowRuns), it has BOTH passed and
 * failed without any code change. Two numbers describe how flaky it is:
 *   - failure rate = failed runs / total runs
 *   - flip rate    = status changes (pass->fail or fail->pass) / (runs - 1)
 * A test that failed in every run is a real, consistent bug - not flaky.
 *
 *   npm run flaky
 */
import { config } from '../config';
import { recentResults } from '../db/database';

export interface TestStability {
  testKey: string;
  title: string;
  module: string;
  runs: number;
  passed: number;
  failed: number;
  failureRate: number;
  flipRate: number;
  history: string; // e.g. "PFPPF" oldest -> newest
  lastStatus: string;
  verdict: 'Flaky' | 'Consistently failing' | 'Stable' | 'Not enough data';
}

export function analyzeTestStability(windowRuns = config.flaky.windowRuns): TestStability[] {
  const byTest = new Map<string, ReturnType<typeof recentResults>>();
  for (const r of recentResults(windowRuns)) {
    if (r.status === 'skipped') continue;
    if (!byTest.has(r.test_key)) byTest.set(r.test_key, []);
    byTest.get(r.test_key)!.push(r);
  }

  const stats: TestStability[] = [];
  for (const [testKey, results] of byTest) {
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.length - passed;
    let flips = 0;
    for (let i = 1; i < results.length; i++) if (results[i].status !== results[i - 1].status) flips++;

    let verdict: TestStability['verdict'] = 'Stable';
    if (results.length < config.flaky.minRuns) verdict = 'Not enough data';
    else if (passed > 0 && failed > 0) verdict = 'Flaky';
    else if (failed > 0) verdict = 'Consistently failing';

    stats.push({
      testKey,
      title: results[0].title,
      module: results[0].module,
      runs: results.length,
      passed,
      failed,
      failureRate: failed / results.length,
      flipRate: results.length > 1 ? flips / (results.length - 1) : 0,
      history: results.map((r) => (r.status === 'passed' ? 'P' : 'F')).join(''),
      lastStatus: results[results.length - 1].status,
      verdict,
    });
  }

  const order = { Flaky: 0, 'Consistently failing': 1, 'Not enough data': 2, Stable: 3 };
  return stats.sort((a, b) => order[a.verdict] - order[b.verdict] || b.flipRate - a.flipRate);
}

export function detectFlakyTests(windowRuns?: number): TestStability[] {
  return analyzeTestStability(windowRuns).filter((s) => s.verdict === 'Flaky');
}

if (require.main === module) {
  const all = analyzeTestStability();
  const flaky = all.filter((s) => s.verdict === 'Flaky');
  console.log(`\nAnalysed ${all.length} tests over the last ${config.flaky.windowRuns} runs\n`);
  if (!flaky.length) {
    console.log('No flaky tests detected (run the suite several times first: npm run pipeline).\n');
  } else {
    console.table(flaky.map((s) => ({
      Test: s.testKey,
      Runs: s.runs,
      Passed: s.passed,
      Failed: s.failed,
      'Failure rate': `${(s.failureRate * 100).toFixed(0)}%`,
      'Flip rate': `${(s.flipRate * 100).toFixed(0)}%`,
      History: s.history,
    })));
  }
}
