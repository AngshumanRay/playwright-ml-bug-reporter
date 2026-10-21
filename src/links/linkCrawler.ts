/**
 * Broken link checker.
 *
 * 1. Crawl: starting from one page, open every page of the same website in a real browser
 *    (so links added by JavaScript are found too) and collect every <a href> link.
 * 2. Check: request every unique link (internal and, optionally, external) and record its HTTP status.
 *    HEAD is tried first; if it fails, GET is used, because some servers do not answer HEAD.
 * 3. A link is BROKEN when it answers with HTTP 4xx/5xx or cannot be reached at all.
 *
 * Used by tests/links.spec.ts - each broken link is reported as a separate bug.
 */
import type { APIRequestContext, Page } from '@playwright/test';

export interface LinkSource {
  page: string;
  text: string;
}

export interface LinkResult {
  url: string;
  internal: boolean;
  status: number; // 0 = no response
  statusText: string;
  error: string | null;
  broken: boolean;
  foundOn: LinkSource[];
}

export interface CrawlResult {
  startUrl: string;
  pagesVisited: string[];
  links: LinkResult[];
  skippedExternal: number;
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  checkExternal: boolean;
  timeoutMs: number;
}

const SKIPPED_SCHEMES = /^(mailto:|tel:|javascript:|data:|#)/i;
// Internal links to files are checked but never opened as pages
const NOT_A_PAGE = /\.(pdf|zip|png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|csv|docx?|xlsx?|pptx?|mp4|mp3)$/i;

function normalize(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

async function checkLink(request: APIRequestContext, url: string, timeout: number) {
  const attempt = async (method: 'head' | 'get') => {
    const res = await request[method](url, { timeout, maxRedirects: 10, failOnStatusCode: false });
    return { status: res.status(), statusText: res.statusText(), error: null as string | null };
  };
  try {
    const head = await attempt('head');
    return head.status < 400 ? head : await attempt('get');
  } catch {
    try {
      return await attempt('get');
    } catch (err) {
      return { status: 0, statusText: '', error: (err as Error).message.split('\n')[0] };
    }
  }
}

export async function crawlAndCheckLinks(page: Page, request: APIRequestContext, options: CrawlOptions): Promise<CrawlResult> {
  const start = normalize(options.startUrl);
  const origin = new URL(start).origin;
  const queue = [start];
  const visited: string[] = [];
  const found = new Map<string, LinkSource[]>();

  // ---- 1. Crawl the website
  while (queue.length && visited.length < options.maxPages) {
    const url = queue.shift()!;
    if (visited.includes(url)) continue;
    visited.push(url);

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: options.timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
    } catch {
      continue; // unreachable pages are reported by the link check below
    }
    const isHtml = (response?.headers()['content-type'] ?? '').includes('text/html');
    if (!response || response.status() >= 400 || !isHtml || new URL(page.url()).origin !== origin) continue;

    const anchors = await page.$$eval('a[href]', (as) =>
      as.map((a) => ({
        raw: a.getAttribute('href') ?? '',
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      })),
    );

    for (const a of anchors) {
      if (!a.raw.trim() || SKIPPED_SCHEMES.test(a.raw.trim()) || !/^https?:/i.test(a.href)) continue;
      const link = normalize(a.href);
      const sources = found.get(link) ?? [];
      if (!sources.some((s) => s.page === url)) sources.push({ page: url, text: a.text });
      found.set(link, sources);

      const internal = new URL(link).origin === origin;
      if (internal && !NOT_A_PAGE.test(new URL(link).pathname) && !visited.includes(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }
  }

  // ---- 2. Check every unique link (8 at a time)
  const entries = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
  const links: LinkResult[] = [];
  let skippedExternal = 0;
  for (let i = 0; i < entries.length; i += 8) {
    const batch = entries.slice(i, i + 8);
    const checked = await Promise.all(
      batch.map(async ([url, foundOn]) => {
        const internal = new URL(url).origin === origin;
        if (!internal && !options.checkExternal) {
          skippedExternal++;
          return null;
        }
        const r = await checkLink(request, url, options.timeoutMs);
        return {
          url,
          internal,
          ...r,
          broken: r.status === 0 || r.status >= 400,
          foundOn: foundOn.sort((a, b) => a.page.localeCompare(b.page)),
        };
      }),
    );
    links.push(...checked.filter((l): l is LinkResult => l !== null));
  }

  return { startUrl: start, pagesVisited: visited, links, skippedExternal };
}
