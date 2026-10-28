// Usage: node entry-graph.mjs <repoRoot>: the static import closure of src/client/main.tsx (sizes per top dir).
import { build } from 'esbuild';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/main.tsx'],
  bundle: true, splitting: true, format: 'esm', outdir: '/tmp/eg-out', write: false, metafile: true, minify: true,
  loader: { '.css': 'empty', '.woff2': 'empty', '.svg': 'empty', '.png': 'empty' },
  alias: { '@': path.join(root, 'src/client') },
  jsx: 'automatic', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
});
const outputs = result.metafile.outputs;
const entry = Object.entries(outputs).find(([, o]) => o.entryPoint);
const seen = new Set(); const stack = [entry[0]];
while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); for (const i of outputs[f].imports) if (i.kind === 'import-statement') stack.push(i.path); }
const inputs = {};
for (const f of seen) for (const [k, v] of Object.entries(outputs[f].inputs)) inputs[k] = (inputs[k] ?? 0) + v.bytesInOutput;
const total = Object.values(inputs).reduce((a, b) => a + b, 0);
console.log('TOTAL static', total);
const groups = {};
for (const [k, v] of Object.entries(inputs)) { const g = k.includes('node_modules') ? k.split('node_modules/').pop().split('/').slice(0, k.includes('/@') ? 2 : 1).join('/') : k.split('/').slice(0, 4).join('/'); groups[g] = (groups[g] ?? 0) + v; }
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(String(v).padStart(8), k);
if (process.argv[3]) for (const [k, v] of Object.entries(inputs).filter(([k]) => k.includes(process.argv[3])).sort((a,b)=>b[1]-a[1]).slice(0,40)) console.log('  ', v, k);
