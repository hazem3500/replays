import { startServer } from '@hazem3500/replays/server';

// The whole "distribution": replays.config.ts says what to load, this starts it. `replays serve` does the same.
try {
  await startServer({ handleSignals: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
