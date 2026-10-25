// The same build contract as custom-distro: a browser ES module served by api.client. No core source aliases.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});
await copyFile(new URL('src/style.css', root), new URL('dist/style.css', root));
console.log('built host-app browser plugin and stylesheet');
