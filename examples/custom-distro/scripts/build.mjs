// Bundles the browser entry (src/client.ts) into dist/client.js: one ES module, which the server plugin serves.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});
console.log('built dist/client.js');
