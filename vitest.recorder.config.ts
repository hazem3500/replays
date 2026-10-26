import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/recorder/**/*.test.ts'], environment: 'happy-dom', globals: true } });
