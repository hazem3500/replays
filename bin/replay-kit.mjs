#!/usr/bin/env node
// Entry point of the `replay-kit` command. A built checkout (`pnpm build:cli`) runs the bundled CLI; otherwise,
// and for `serve` (which needs the whole repository: the server, the built viewer, the samples), the TypeScript
// sources run directly with Node's type stripping.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const built = fileURLToPath(new URL('../dist/cli/cli.mjs', import.meta.url));
const source = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const args = process.argv.slice(2);

if (existsSync(built) && args[0] !== 'serve') {
  await import(pathToFileURL(built).href);
} else if (existsSync(source)) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', source, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  console.error('replay-kit: neither dist/cli/cli.mjs nor src/cli.ts exists; run `pnpm build:cli`.');
  process.exit(1);
}
