import { startServer } from './start.ts';

// `replays serve` / `pnpm start` / `pnpm dev`: configuration comes from the environment and `replays.config.*`
// (src/config/, docs/extension-api.md). Your own entry can call `startServer()` with options instead.
try {
  await startServer({ dev: process.argv.includes('--dev'), handleSignals: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
