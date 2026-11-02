import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

export default defineConfig({
  // Lazy inspector imports must be optimized before the browser starts; mid-run reloads invalidate tests.
  optimizeDeps: {
    include: ['zod', '@tanstack/query-db-collection', '@tanstack/react-db', '@tanstack/react-table', '@tanstack/react-virtual'],
  },
  plugins: [storybookTest({ configDir: fileURLToPath(new URL('.', import.meta.url)) })],
  test: {
    name: 'storybook',
    setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {}),
        contextOptions: { reducedMotion: 'reduce' },
      }),
      viewport: { width: Number(process.env.STORYBOOK_TEST_WIDTH ?? 1280), height: 800 },
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
