import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { headInjector, shellHead } from '../src/server/pages/head.ts';
import { loadStartRenderer, type PageRenderer } from '../src/server/pages/start.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';

const INDEX = `<!doctype html><html><head><meta charset="UTF-8" />
<!-- a comment --><meta name="app-base" content="" /><title>__PRODUCT_NAME__</title>
<script>document.documentElement.dataset.theme = 'dark';</script>
<script type="module" crossorigin src="./assets/main-abc.js"></script>
<link rel="modulepreload" crossorigin href="./assets/react-abc.js">
<link rel="stylesheet" crossorigin href="./assets/main-abc.css">
</head><body><div id="root"></div></body></html>`;

async function collect(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let text = '';
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) text += decoder.decode(next.value, { stream: true });
  return text + decoder.decode();
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

/** Our server with a page renderer: a stub, or the real one loaded around `createApp`'s own handler. */
async function start(renderer: PageRenderer | ((api: Parameters<typeof loadStartRenderer>[1]) => Promise<PageRenderer>)) {
  const root = await mkdtemp(join(tmpdir(), 'replays-pages-'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(join(root, 'client', 'index.html'), INDEX);
  const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
  const app: { handle?: ReturnType<typeof createApp> } = {};
  const handle = (...args: Parameters<ReturnType<typeof createApp>>) => (app.handle ? app.handle(...args) : Promise.resolve());
  const pages = typeof renderer === 'function' ? await renderer(handle) : renderer;
  app.handle = createApp({
    ...appDefaults(),
    store,
    clientDir: join(root, 'client'),
    pages: { renderer: pages, clientDir: join(root, 'start') },
  });
  const server = createServer((request, response) => void handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  return `http://127.0.0.1:${address.port}`;
}

describe('the page head Start renders with', () => {
  it('keeps the deployment’s metas and inline scripts and drops the single-page app’s own bundle', () => {
    const head = shellHead(INDEX);
    expect(head).toContain('<meta name="app-base" content="" />');
    expect(head).toContain("dataset.theme = 'dark'");
    expect(head).not.toMatch(/main-abc\.js|react-abc\.js|main-abc\.css|a comment/);
  });

  it('is added right after the opening head tag even when the tag spans stream chunks', async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of ['<!DOCTYPE html><html><he', 'ad><title>x</title></head><body>', '</body></html>'])
          controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    expect(await collect(source.pipeThrough(headInjector('<meta name="app-base" content="/" />')))).toBe(
      '<!DOCTYPE html><html><head><meta name="app-base" content="/" /><title>x</title></head><body></body></html>',
    );
  });
});

describe('pages rendered by Start', () => {
  it('hands a browser page load to the renderer with the deployment and the stamped head', async () => {
    const calls: Array<{ base: string; head: string }> = [];
    const origin = await start({
      render: (_request, response, page) => {
        calls.push({ base: page.deployment.base, head: page.head });
        response.writeHead(200, { 'content-type': 'text/html' }).end('<html>start</html>');
        return Promise.resolve();
      },
    });
    const page = await fetch(`${origin}/r/demo`, { headers: { accept: 'text/html' } });
    expect(await page.text()).toBe('<html>start</html>');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.base).toBe('');
    expect(calls[0]?.head).toContain('<meta name="app-base" content="/" />');
    expect(calls[0]?.head).not.toContain('main-abc.js');
  });

  it('keeps API requests on the server’s own routes', async () => {
    const origin = await start({ render: () => Promise.reject(new Error('not a page')) });
    const replays = await fetch(`${origin}/api/replays`, { headers: { accept: 'text/html' } });
    expect(replays.headers.get('content-type')).toContain('application/json');
  });

  it('streams the Start entry’s page with the head added, and answers its loaders’ API calls in process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replays-start-entry-'));
    const entry = join(dir, 'server.js');
    await writeFile(
      entry,
      `export default { async fetch(request) {
        const context = globalThis.__replaysPages.get(request.headers.get('x-replays-page'));
        const list = await context.api('replays');
        return new Response('<!DOCTYPE html><html><head><title>t</title></head><body>' + list.status + ' ' + (await list.text()) + '</body></html>', { headers: { 'content-type': 'text/html' } });
      } };`,
    );
    const origin = await start((api) => loadStartRenderer(entry, api));
    const page = await fetch(`${origin}/`, { headers: { accept: 'text/html', 'accept-encoding': 'gzip', 'x-replays-page': 'forged' } });
    expect(page.headers.get('content-encoding')).toBe('gzip');
    const html = await page.text();
    expect(html).toMatch(/^<!DOCTYPE html><html><head><meta charset="UTF-8" \/>/);
    expect(html).toContain('<body>200 [');
  });
});
