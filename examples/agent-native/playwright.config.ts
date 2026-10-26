import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? process.env.CHROME_PATH;
export default defineConfig({
  testDir: 'test',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--enable-features=WebMCP', '--disable-webgl', ...(process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
    },
  },
});
