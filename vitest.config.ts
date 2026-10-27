import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite-plus/test/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  test: {
    pool: 'threads',
    maxWorkers: 2,
    include: ['test/**/*.test.ts', 'src/recorder/**/*.test.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
});
