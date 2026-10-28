// Usage: node why.mjs <repoRoot> <target substring>...: shortest static import chain from main.tsx to each target.
import { build } from 'esbuild';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const r = await build({ absWorkingDir: root, entryPoints: ['src/client/main.tsx'], bundle: true, write: false, metafile: true, format: 'esm', splitting: true, outdir: '/tmp/w',
  loader: { '.css': 'empty', '.woff2': 'empty', '.svg': 'empty', '.png': 'empty' }, alias: { '@': path.join(root, 'src/client') }, jsx: 'automatic', logLevel: 'error' });
const inputs = r.metafile.inputs;
for (const target of process.argv.slice(3)) {
  const prev = new Map([['src/client/main.tsx', null]]); const q = ['src/client/main.tsx']; let hit;
  while (q.length) { const f = q.shift(); if (f.includes(target)) { hit = f; break; }
    for (const i of inputs[f]?.imports ?? []) if (i.kind === 'import-statement' && !prev.has(i.path)) { prev.set(i.path, f); q.push(i.path); } }
  const chain = []; for (let f = hit; f; f = prev.get(f)) chain.unshift(f);
  console.log(target, '=>', hit ? chain.join('\n    -> ') : 'not static');
}
