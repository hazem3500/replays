// The library entries (package.json `exports`) as ES modules in dist/lib, sharing code through chunks so a class (such as
// PluginError) is the same one whichever entry you import it from. Types come from `tsc -p tsconfig.lib.json`.
import { resolve } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';

const root = process.env.REPLAYS_BUILD_ROOT ? resolve(process.env.REPLAYS_BUILD_ROOT) : resolve(import.meta.dirname, '..');
const configuredEntries = {
  index: 'src/index.ts',
  capture: 'src/capture/index.ts',
  server: 'src/server/index.ts',
  'server-testing': 'src/server/testing/index.ts',
  plugin: 'src/plugin/index.ts',
  config: 'src/config/index.ts',
  viewer: 'src/client/plugins/api.ts',
  model: 'src/shared/model.ts',
  'viewer-playback': 'src/client/playback/index.ts',
  'viewer-diagnostics': 'src/client/diagnostics.ts',
  'viewer-react': 'src/client/compose/index.ts',
  'plugins-iap': 'src/first-party/iap.ts',
  'plugins-gcs': 'src/first-party/gcs.ts',
};

const configuredStyles = {
  'viewer-playback': 'playback/playback.css',
  'viewer-react': 'compose/stage.css',
};

/** Baseline metadata must describe its own exported graph, including entries added or removed across revisions. */
async function baselineEntries() {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const targets = new Set();
  function visit(value) {
    if (typeof value === 'string') targets.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(manifest.exports);
  const entries = {};
  const styles = {};
  for (const target of targets) {
    const match = /^\.\/dist\/lib\/([a-z-]+)\.(mjs|css)$/.exec(target);
    if (!match) continue;
    const [, name, extension] = match;
    // invariant: the baseline's recorder build already emitted its separately managed entries and chunk metadata.
    if (extension === 'mjs' && /^recorder(?:-|$)/.test(name)) continue;
    const sources = extension === 'css' ? configuredStyles : configuredEntries;
    if (!Object.hasOwn(sources, name)) throw new Error(`Cannot rebuild baseline export ${target}: no source mapping`);
    if (extension === 'css') styles[name] = sources[name];
    else entries[name] = sources[name];
  }
  if (!Object.keys(entries).length) throw new Error('Baseline package has no configured library exports');
  return {
    entries: Object.fromEntries(Object.entries(configuredEntries).filter(([name]) => Object.hasOwn(entries, name))),
    styles: Object.fromEntries(Object.entries(configuredStyles).filter(([name]) => Object.hasOwn(styles, name))),
  };
}

const { entries, styles } = process.env.REPLAYS_BUILD_ROOT
  ? await baselineEntries()
  : { entries: configuredEntries, styles: configuredStyles };

// Esbuild does not empty outDir; never pack stale shared chunks from a previous graph.
await rm(resolve(root, 'dist/lib/chunks'), { recursive: true, force: true });
const library = await build({
  absWorkingDir: root,
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
  metafile: true,
});
// Stable shared-chunk identities for size deltas: hash source membership, not emitted content.
await writeFile(resolve(root, 'dist/lib/.metafile.json'), JSON.stringify(library.metafile));
console.log(`built ${Object.keys(entries).length} library entries in dist/lib`);

for (const [name, source] of Object.entries(styles)) {
  await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, 'src/client', source)],
    outfile: resolve(root, `dist/lib/${name}.css`),
    bundle: true,
    logLevel: 'warning',
  });
}
if (Object.keys(styles).length) {
  await mkdir(resolve(root, 'dist/types/client/styles'), { recursive: true });
  await writeFile(resolve(root, 'dist/types/client/styles/render.d.ts'), 'export {};\n');
}

// The page-side recorder next to the entries, for `recorderSource()` (src/capture/session.ts).
await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, 'src/capture/injected-recorder.ts')],
  outfile: resolve(root, 'dist/lib/recorder.iife.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  minify: true,
  logLevel: 'warning',
});
