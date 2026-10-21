import { defineConfig, devices } from '@playwright/test';
import { config } from './src/config';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Retries are disabled on purpose: flaky tests are detected ACROSS runs (see src/flaky/flakyDetector.ts)
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 3_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'reports/playwright-html' }],
    ['./src/reporter/bugReporter.ts'],
  ],
  use: {
    baseURL: `http://localhost:${config.demoAppPort}`,
    screenshot: 'only-on-failure',
    // Slow down every browser action (ms) - handy in headed mode for demos, e.g. SLOW_MO=500
    launchOptions: { slowMo: Number(process.env.SLOW_MO ?? 0) },
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Starts the ShopEase demo application automatically before the tests
  webServer: {
    command: 'npx tsx demo-app/server.ts',
    url: `http://localhost:${config.demoAppPort}/login.html`,
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
