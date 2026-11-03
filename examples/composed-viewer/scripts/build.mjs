import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: { client: 'src/client.tsx', headless: 'src/headless.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});
await Promise.all(['index.html', 'headless.html'].map((file) => copyFile(new URL(file, root), new URL(`dist/${file}`, root))));
