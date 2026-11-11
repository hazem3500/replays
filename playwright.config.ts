import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? process.env.CHROME_PATH;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // why: CI shards run on four-core runners; each spec drives its own Chromium and the server stays on one core.
  workers: process.env.CI ? 4 : 1,
  timeout: 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // why: a passing test's trace is never read; the retry of a failure records the one that is.
    trace: 'on-first-retry',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      ...(process.env.CHROMIUM_NO_SANDBOX === '1' ? { args: ['--no-sandbox'] } : {}),
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
