import { fileURLToPath } from 'node:url';
import { startServer } from '@hazem3500/replays/server';

await startServer({ cwd: fileURLToPath(new URL('../', import.meta.url)), handleSignals: true });
