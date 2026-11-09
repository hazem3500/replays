#!/usr/bin/env node
// Entry point of the `replays` command. A built checkout (`pnpm build:cli`) runs the bundled CLI; otherwise,
// and for `serve` (which needs the whole repository: the server, the built viewer, the samples), the TypeScript
// sources run directly with Node's type stripping.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const built = fileURLToPath(new URL('../dist/cli/cli.mjs', import.meta.url));
const source = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

if (
  args[0] === 'serve' &&
  !wantsHelp &&
  !existsSync(source) &&
  existsSync(fileURLToPath(new URL('../dist/lib/server.mjs', import.meta.url)))
) {
  // An installed package ships the built server (dist/lib/server.mjs), not the sources.
  const { startServer } = await import('../dist/lib/server.mjs');
  try {
    await startServer({ handleSignals: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (existsSync(built) && (args[0] !== 'serve' || wantsHelp)) {
  await import(pathToFileURL(built).href);
} else if (existsSync(source)) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', source, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  console.error('replays: neither dist/cli/cli.mjs nor src/cli.ts exists; run `pnpm build:cli`.');
  process.exit(1);
}
