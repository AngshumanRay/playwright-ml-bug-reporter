import { test, expect } from '@playwright/test';
import { config } from '../src/config';
import { crawlAndCheckLinks } from '../src/links/linkCrawler';

test.describe('Links', { tag: '@Links' }, () => {
  test('all links on the website are reachable', async ({ page, request }, testInfo) => {
    test.setTimeout(300_000);
    const startUrl = new URL(config.linkCheck.startUrl, testInfo.project.use.baseURL).href;
    const result = await crawlAndCheckLinks(page, request, { ...config.linkCheck, startUrl });
    const broken = result.links.filter((l) => l.broken);

    // Full list of every link and its status, attached to the Playwright HTML report
    await testInfo.attach('link-check-report.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.log(
      `[LinkChecker] ${result.pagesVisited.length} page(s) crawled, ${result.links.length} unique link(s) checked, ` +
      `${broken.length} broken${result.skippedExternal ? `, ${result.skippedExternal} external skipped` : ''}`,
    );

    expect(result.pagesVisited.length, `Link checker could not open the start page ${startUrl}`).toBeGreaterThan(0);

    // One soft assertion per broken link -> the BugReporter logs each one as a separate bug
    for (const link of broken) {
      const where = link.foundOn.slice(0, 3).map((s) => `${s.page} (link text "${s.text}")`).join(', ');
      const more = link.foundOn.length > 3 ? ` and ${link.foundOn.length - 3} more page(s)` : '';
      const received = link.error ? `No response: ${link.error}` : `HTTP ${link.status} ${link.statusText}`.trim();
      expect.soft(received, `Broken link: ${link.url}\nFound on: ${where}${more}`).toBe('HTTP 200 OK');
    }
  });
});
