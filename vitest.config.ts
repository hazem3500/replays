import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts', 'src/recorder/**/*.test.ts'],
    coverage: { reporter: ['text', 'json-summary'] },
  },
});
