/**
 * Test suites offered in the Test Runner dropdown.
 *
 * A test joins a suite through a Playwright tag on the test, e.g.
 *   test('user can log in', { tag: ['@smoke', '@sanity'] }, async ({ page }) => { ... })
 * Regression runs every test, so it needs no tag.
 */
export interface Suite {
  id: string;
  name: string;
  grep: string | null; // Playwright --grep filter; null = all tests
  description: string;
}

export const SUITES: Suite[] = [
  { id: 'smoke', name: 'Smoke', grep: '@smoke', description: 'Quick health check of the most important user journeys' },
  { id: 'sanity', name: 'Sanity', grep: '@sanity', description: 'Core functionality of every module' },
  { id: 'regression', name: 'Regression', grep: null, description: 'The complete suite: every test, including the link check' },
  { id: 'links', name: 'Broken links', grep: '@Links', description: 'Crawl the whole website and report every broken link' },
];

/** Tags that name a suite (every other tag on a test names its module). */
export const SUITE_TAGS = ['@smoke', '@sanity', '@regression'];

export function getSuite(id: string | null | undefined): Suite | undefined {
  return SUITES.find((s) => s.id === id);
}

export function suiteLabel(id: string | null | undefined): string {
  return getSuite(id)?.name ?? 'Command line';
}
