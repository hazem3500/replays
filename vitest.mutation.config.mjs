import base from './vitest.config.ts';
import { configDefaults } from 'vitest/config';

export default {
  ...base,
  test: {
    ...base.test,
    testTimeout: 15000,
    hookTimeout: 30000,
    // why: The nested Vite dev server exits with SIGKILL against mutation-instrumented app source; pnpm check still runs it.
    exclude: [...configDefaults.exclude, ...(base.test.exclude ?? []), 'test/dev-index-page.test.ts'],
  },
};
