import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { loadPagePreloads, pagePreloadInjector } from '../src/server/pages/preloads.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function preloads() {
  const root = await mkdtemp(join(tmpdir(), 'replays-preloads-'));
  roots.push(root);
  await mkdir(join(root, 'client/.vite'), { recursive: true });
  await writeFile(
    join(root, 'client/.vite/manifest.json'),
    JSON.stringify({
      index: { name: 'ReplayIndex', file: 'assets/index.js', imports: ['shared'], dynamicImports: ['viewer'] },
      viewer: { name: 'Viewer', file: 'assets/viewer.js', imports: ['shared', 'player'], css: ['assets/viewer.css'] },
      editor: { name: 'Editor', file: 'assets/editor.js', imports: ['player'] },
      suite: { name: 'SuiteWorkspace', file: 'assets/suite.js', imports: ['viewer'] },
      shared: { file: 'assets/shared.js', imports: ['shared'] },
      player: { file: 'assets/rrweb.js' },
    }),
  );
  return loadPagePreloads(join(root, 'server/server.js'));
}

it('preloads the base-prefixed index and its static imports without following player dynamic imports', async () => {
  const select = await preloads();
  expect(select('/kept/?tag=x', '/kept', {})).toEqual(['/kept/assets/index.js', '/kept/assets/shared.js']);
  expect(select('/elsewhere/', '/kept', {})).toEqual([]);
});

it('preloads the direct replay and suite players without the retained index', async () => {
  const select = await preloads();
  expect(select('/r/demo', '', {})).toContain('/assets/rrweb.js');
  expect(select('/r/demo', '', {})).toContain('/assets/viewer.css');
  expect(select('/s/demo/r/run', '', {})).toContain('/assets/suite.js');
  expect(select('/r/demo', '', {})).not.toContain('/assets/editor.js');
  expect(select('/r/demo', '', {})).not.toContain('/assets/index.js');
});

it('withholds editor chunks when the host disables editing or its beta', async () => {
  const select = await preloads();
  expect(select('/r/demo/edit', '', {})).toEqual([]);
  expect(select('/r/demo/edit', '', { 'app-beta': 'editor', 'app-editing': 'off' })).toEqual([]);
  expect(select('/r/demo/edit', '', { 'app-beta': 'editor' })).toEqual(['/assets/editor.js', '/assets/rrweb.js']);
});

it('deduplicates Start preloads across head chunks and preserves streamed UTF-8 body bytes', async () => {
  const bytes = new TextEncoder().encode(
    '<html><head><link href="/assets/shared.js" fetchPriority="low" rel="modulepreload"/><link rel="stylesheet" href="/assets/shared.css"></head><body>é</body></html>',
  );
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const html = await new Response(
    source.pipeThrough(
      pagePreloadInjector(['/assets/shared.js', '/assets/index.js', '/assets/index.js', '/assets/shared.css', '/assets/viewer.css']),
    ),
  ).text();
  expect(html.match(/shared.js/g)).toHaveLength(1);
  expect(html.match(/index.js/g)).toHaveLength(1);
  expect(html.match(/shared.css/g)).toHaveLength(1);
  expect(html).toContain('<link rel="preload" as="style" crossorigin fetchpriority="high" href="/assets/viewer.css">');
  expect(html).toContain('href="/assets/shared.js" rel="modulepreload" crossorigin fetchpriority="high">');
  expect(html).not.toContain('fetchPriority="low"');
  expect(html).toContain('</head><body>é</body>');
});
