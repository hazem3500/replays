import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const app = process.cwd();
const reactDependency = /node_modules\/react(?:-dom)?\//;
const routerDependency = /node_modules\/@tanstack\//;
const cases = [
  {
    name: 'portable',
    source: `export * from '@hazem3500/replays/model';
export * from '@hazem3500/replays/viewer/diagnostics';`,
    independent: true,
  },
  {
    name: 'playback',
    source: `export * from '@hazem3500/replays/viewer/playback';
import '@hazem3500/replays/viewer/playback/style.css';`,
    independent: true,
    css: true,
  },
  {
    name: 'react',
    source: `export * from '@hazem3500/replays/viewer/react';
import '@hazem3500/replays/viewer/react/style.css';`,
    css: true,
  },
  {
    name: 'recorder',
    source: `export * from '@hazem3500/replays/recorder';
export * from '@hazem3500/replays/recorder/kit';`,
    independent: true,
  },
  {
    name: 'recorder-ui',
    source: `export * from '@hazem3500/replays/recorder/ui';`,
    independent: true,
    motion: true,
  },
  { name: 'recorder-react', source: `export * from '@hazem3500/replays/recorder/react';` },
];

function staticClosure(result, entry) {
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);
    for (const dependency of result.metafile.outputs[path].imports) {
      assert.ok(!dependency.external, `${entry}: unresolved ${dependency.path}`);
      if (dependency.kind !== 'dynamic-import') visit(dependency.path);
    }
  }
  visit(entry);
  return [...visited];
}

for (const scenario of cases) {
  const result = await build({
    absWorkingDir: app,
    stdin: { contents: scenario.source, resolveDir: app, sourcefile: `${scenario.name}.js` },
    outdir: resolve(app, `browser-smoke/${scenario.name}`),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'warning',
  });
  const outputs = Object.entries(result.metafile.outputs);
  const entry = outputs.find(([, output]) => output.entryPoint === `${scenario.name}.js`)?.[0];
  assert.ok(entry, `${scenario.name}: entry emitted`);
  const closure = staticClosure(result, entry);
  const inputs = closure.flatMap((file) => Object.keys(result.metafile.outputs[file].inputs));
  assert.ok(!inputs.some((file) => routerDependency.test(file)), `${scenario.name}: no application router or data cache`);
  if (scenario.independent) assert.ok(!inputs.some((file) => reactDependency.test(file)), `${scenario.name}: no React`);
  if (scenario.name === 'portable')
    assert.ok(
      !inputs.some((file) => /node_modules\/(?:rrweb|motion|motion-dom)\//.test(file)),
      'portable models do not load the rendering engine',
    );
  if (scenario.name === 'recorder') {
    assert.ok(
      !inputs.some((file) => /node_modules\/(?:motion|motion-dom|motion-utils)\//.test(file)),
      'headless recorder does not load UI motion',
    );
  }
  if (scenario.css)
    assert.ok(
      outputs.some(([file]) => file.endsWith('.css')),
      `${scenario.name}: renderer CSS resolves`,
    );
  if (scenario.motion)
    assert.ok(
      inputs.some((file) => file.includes('node_modules/motion-dom/')),
      'recorder UI resolves its Motion dependency',
    );
  for (const file of Object.values(result.metafile.inputs)) {
    for (const dependency of file.imports) {
      assert.ok(!dependency.path.startsWith('node:') && !builtinModules.includes(dependency.path), `${scenario.name}: no Node imports`);
    }
  }
}
console.log('packed browser compositions ok');
