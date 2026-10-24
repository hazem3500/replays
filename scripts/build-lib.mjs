// The library entries (package.json `exports`) as ES modules in dist/lib, sharing code through chunks so a class (such as
// PluginError) is the same one whichever entry you import it from. Types come from `tsc -p tsconfig.lib.json`.
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const entries = {
  index: 'src/index.ts',
  capture: 'src/capture/index.ts',
  server: 'src/server/index.ts',
  'server-testing': 'src/server/testing/index.ts',
  plugin: 'src/plugin/index.ts',
  config: 'src/config/index.ts',
  viewer: 'src/client/plugins/api.ts',
  'plugins-iap': 'src/first-party/iap.ts',
  'plugins-gcs': 'src/first-party/gcs.ts',
};

await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, resolve(root, file)])),
  outdir: resolve(root, 'dist/lib'),
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});
console.log(`built ${Object.keys(entries).length} library entries in dist/lib`);

// The page-side recorder next to the entries, for `recorderSource()` (src/capture/session.ts).
await build({
  entryPoints: [resolve(root, 'src/capture/injected-recorder.ts')],
  outfile: resolve(root, 'dist/lib/recorder.iife.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});
