import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus/test/config';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['kit', 'react', 'ui', 'testing', ''].map((name) => [
        `@hazem3500/replays/recorder${name ? `/${name}` : ''}`,
        fileURLToPath(new URL(`./src/recorder/${name ? `${name}/` : ''}index.${name === 'react' ? 'tsx' : 'ts'}`, import.meta.url)),
      ]),
    ),
  },
  test: {
    setupFiles: ['test/setup/animation-cancellation.ts'],
    include: ['src/recorder/**/*.test.ts', 'src/recorder/**/*.test.tsx'],
    environment: 'happy-dom',
    globals: true,
  },
});
