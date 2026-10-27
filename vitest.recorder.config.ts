import { defineConfig } from 'vite-plus/test/config';
export default defineConfig({ test: { include: ['src/recorder/**/*.test.ts'], environment: 'happy-dom', globals: true } });
