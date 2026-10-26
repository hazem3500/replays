import { build } from 'esbuild';
await build({
  entryPoints: ['src/recorder/index.ts'],
  outfile: 'dist/lib/recorder.mjs',
  bundle: true,
  splitting: false,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['rrweb'],
  metafile: true,
}).then(({ metafile }) => {
  const inputs = Object.keys(metafile.inputs);
  if (inputs.some((p) => !p.startsWith('src/recorder/'))) throw new Error('Recorder includes non-browser source');
});
