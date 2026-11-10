// Bundles the CLI into dist/cli: cli.mjs (capture, import, upload, probe, suite, login and the rest), edit.mjs (loaded on demand),
// the page-side recorder script it injects (recorder.iife.js), server-commands.mjs and viewer-runtime.mjs. The CLI commands are
// self-contained: only playwright-core stays external, so installing the package for the CLI does not install the viewer's
// dependencies. server-commands.mjs keeps its packages external; bin/replays.mjs loads it, and `serve`, from the package or
// from the viewer runtime that src/viewer-runtime.ts installs on first use.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = process.env.REPLAYS_CLI_OUT ? resolve(process.env.REPLAYS_CLI_OUT) : join(root, 'dist/cli');
await mkdir(out, { recursive: true });

const node = { bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', metafile: true, minifyWhitespace: true };
// why: bundled CommonJS packages (ws) call require(), which an ES module output only has through createRequire.
const banner = { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" };
// why: ws loads these native accelerators when present and falls back to plain JavaScript otherwise.
const cliExternal = ['playwright-core', 'esbuild', 'bufferutil', 'utf-8-validate'];

await build({
  entryPoints: [join(root, 'src/capture/injected-recorder.ts')],
  outfile: join(out, 'recorder.iife.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});

// why: the edit commands load on demand from their own file, so every other command starts without parsing them.
const onDemand = {
  name: 'on-demand',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/edit\/cli\.ts$/ }, () => ({ path: './edit.mjs', external: true }));
    builder.onResolve({ filter: /^\.\/server-commands\.ts$/ }, () => ({ path: './server-commands.mjs', external: true }));
  },
};

const results = {
  edit: await build({
    ...node,
    entryPoints: [join(root, 'src/edit/cli.ts')],
    outfile: join(out, 'edit.mjs'),
    external: cliExternal,
    banner,
  }),
  cli: await build({
    ...node,
    entryPoints: [join(root, 'src/cli.ts')],
    outfile: join(out, 'cli.mjs'),
    plugins: [onDemand],
    external: [...cliExternal, './server/main.ts'],
    banner,
  }),
  runtime: await build({
    ...node,
    entryPoints: [join(root, 'src/viewer-runtime.ts')],
    outfile: join(out, 'viewer-runtime.mjs'),
    packages: 'external',
  }),
  server: await build({
    ...node,
    entryPoints: [join(root, 'src/server-commands.ts')],
    outfile: join(out, 'server-commands.mjs'),
    packages: 'external',
  }),
};
if (process.env.REPLAYS_CLI_METAFILE)
  await writeFile(
    process.env.REPLAYS_CLI_METAFILE,
    JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, { metafile }]) => [name, metafile]))),
  );
console.log(`built ${join(out, 'cli.mjs')}`);
