import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
const { metafile } = await build({
  entryPoints: {
    recorder: 'src/recorder/index.ts',
    'recorder-kit': 'src/recorder/kit/index.ts',
    'recorder-ui': 'src/recorder/ui/index.ts',
    'recorder-react': 'src/recorder/react/index.tsx',
    'recorder-testing': 'src/recorder/testing/index.ts',
  },
  outdir: 'dist/lib',
  outExtension: { '.js': '.mjs' },
  chunkNames: 'recorder-chunks/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['rrweb', 'react', 'react/jsx-runtime', 'node:assert/strict'],
  metafile: true,
});
if (Object.keys(metafile.inputs).some((path) => !path.startsWith('src/recorder/'))) throw new Error('Recorder includes non-browser source');
const visited = new Set();
function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const output = metafile.outputs[path];
  if (!output) return;
  if (Object.keys(output.inputs).some((input) => /default-ui|text-motion|\/react\//.test(input)))
    throw new Error('Headless core includes UI or React');
  for (const dep of output.imports) if (!dep.external && dep.kind !== 'dynamic-import') visit(dep.path);
}
visit('dist/lib/recorder.mjs');
for (const path of visited) {
  const code = await readFile(path, 'utf8');
  if (/attachShadow|const STYLES/.test(code)) throw new Error('Headless core includes default UI DOM/styles');
}
await writeFile('dist/lib/recorder-metafile.json', JSON.stringify(metafile, null, 2));
console.log(
  `Recorder headless: ${metafile.outputs['dist/lib/recorder.mjs'].bytes} entry bytes; ${[...visited].reduce((sum, path) => sum + (metafile.outputs[path]?.bytes ?? 0), 0)} bytes including static chunks`,
);
