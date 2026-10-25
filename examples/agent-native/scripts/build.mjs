import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
  metafile: true,
});
console.log(`Agent-Native browser plugin: ${result.metafile.outputs['dist/client.js'].bytes} bytes`);
