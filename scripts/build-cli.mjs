// Bundles the CLI (capture, import, upload) into dist/cli/cli.mjs, plus the page-side recorder script it injects
// (dist/cli/recorder.iife.js). Dependencies stay external: `npm install` provides them. `serve` is not bundled; it
// runs from the repository (bin/replays.mjs).
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist/cli');
await mkdir(out, { recursive: true });

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
const editOnDemand = {
  name: 'edit-on-demand',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/edit\/cli\.ts$/ }, () => ({ path: './edit.mjs', external: true }));
  },
};

await build({
  entryPoints: [join(root, 'src/edit/cli.ts')],
  outfile: join(out, 'edit.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});

await build({
  entryPoints: [join(root, 'src/cli.ts')],
  outfile: join(out, 'cli.mjs'),
  plugins: [editOnDemand],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  external: ['./server/main.ts'],
  logLevel: 'warning',
});
console.log(`built ${join(out, 'cli.mjs')}`);
