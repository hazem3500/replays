#!/usr/bin/env node
// Entry point of the `replays` command. A built checkout (`pnpm build:cli`) runs the bundled CLI; otherwise
// the TypeScript sources run directly with Node's type stripping. The bundled CLI needs only playwright-core.
// `serve` and the other server-side commands (migrate, mcp, build-static, plugin) need the viewer's dependencies, so an
// installed package without them runs from a copy beside a one-time install in the user cache (src/viewer-runtime.ts).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const built = fileURLToPath(new URL('../dist/cli/cli.mjs', import.meta.url));
const source = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const serverCommands = ['serve', 'migrate', 'mcp', 'build-static', 'plugin'];
const needsRuntime = serverCommands.includes(args[0]) && !wantsHelp;

if (needsRuntime && !existsSync(source) && existsSync(built)) {
  try {
    const { prepareViewerRuntime } = await import('../dist/cli/viewer-runtime.mjs');
    const runtime = await prepareViewerRuntime({ packageRoot });
    if (args[0] === 'serve') {
      const { startServer } = await import(pathToFileURL(`${runtime}/dist/lib/server.mjs`).href);
      await startServer({ handleSignals: true });
    } else {
      await import(pathToFileURL(`${runtime}/dist/cli/cli.mjs`).href);
    }
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
