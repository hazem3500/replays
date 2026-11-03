import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const port = process.env['COMPOSED_VIEWER_TEST_PORT'] ?? '8093';
const origin = `http://127.0.0.1:${port}`;
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] ?? process.env['CHROME_PATH'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      ...(process.env['CHROMIUM_NO_SANDBOX'] === '1' ? { args: ['--no-sandbox'] } : {}),
    },
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { PORT: port },
    url: `${origin}/headless.html`,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});
