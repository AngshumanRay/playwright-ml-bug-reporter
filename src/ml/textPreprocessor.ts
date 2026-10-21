/**
 * Turns a raw Playwright error message into a list of features (tokens) for the ML model.
 *
 * Steps:
 *  1. Remove ANSI colour codes that Playwright adds to terminal output, and the
 *     "Locator:" / "Timeout:" lines that appear in every assertion failure (they describe
 *     the test, not the defect, so they would only add noise).
 *  2. Lower-case the text.
 *  3. Keep HTTP status codes (e.g. 404, 500) as meaningful tokens ("http500"),
 *     replace every other number with the placeholder "num" (prices, timeouts, ids).
 *  4. Split on anything that is not a letter or digit.
 *  5. Remove stop-words and one-letter tokens.
 *  6. Add bigrams (pairs of neighbouring words) so phrases like "server error" become features.
 */

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const BOILERPLATE_LINE = /^\s*(Locator|Timeout):.*$/gm;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'at', 'for', 'with', 'by', 'from', 'as', 'it', 'its', 'this', 'that', 'these', 'those',
  'when', 'while', 'after', 'before', 'into', 'than', 'then', 'so', 'if', 'do', 'does', 'did',
  'has', 'have', 'had', 'will', 'would', 'should', 'can', 'could', 'expect', 'expected', 'received',
  'locator', 'error', 'failed', 'page',
]);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function tokenize(text: string): string[] {
  const cleaned = stripAnsi(text)
    .replace(BOILERPLATE_LINE, ' ')
    .toLowerCase()
    .replace(/\b([45]\d\d)\b/g, ' http$1 ')
    .replace(/\d+(\.\d+)?/g, ' num ');

  const words = cleaned
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) bigrams.push(`${words[i]}_${words[i + 1]}`);

  return [...words, ...bigrams];
}
