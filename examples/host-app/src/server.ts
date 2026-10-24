import { fileURLToPath } from 'node:url';

import { startServer } from '@hazem3500/replays/server';

// Pin discovery to this distribution, even if the entry point is launched from another working directory.
try {
  await startServer({ cwd: fileURLToPath(new URL('../', import.meta.url)), handleSignals: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
