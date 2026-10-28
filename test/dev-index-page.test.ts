import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/server/app.ts';
import { ProfileCatalog } from '../src/server/profiles.ts';
import { ReplayStore } from '../src/server/store.ts';
import { startServer, type RunningServer } from '../src/server/start.ts';
import { appDefaults } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
const devServers: RunningServer[] = [];

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('dev index page', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
    await Promise.all(devServers.splice(0).map((server) => server.close()));
  });
  it('transforms query-string navigations with Vite and retains server-owned metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-dev-query-'));
    const server = await startServer({
      application: false,
      dev: true,
      port: 0,
      env: { DATA_DIR: root, POSTERS_DISABLED: '1', RENDER_DISABLED: '1' },
      config: {
        dir: process.cwd(),
        file: { name: 'Dev metadata', profiles: [{ id: 'triage', label: 'Triage' }] },
        plugins: [],
      },
      log: () => {},
    });
    devServers.push(server);
    for (const path of ['/', '/?host=shop.test', '/?errors=1&profile=triage']) {
      const response = await fetch(`${server.origin}${path}`, { headers: { accept: 'text/html' } });
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('name="app-profiles" content="[{&quot;id&quot;:&quot;triage&quot;');
      expect(html).toContain('name="app-name" content="replays"');
    }
  }, 30_000);

  it('applies the shared server meta renderer after Vite transforms the HTML', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replays-dev-index-'));
    let transformedUrl = '';
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'), 30, {
      profiles: new ProfileCatalog([{ info: { id: 'triage', label: 'Triage', order: 0 } }]),
    });
    const handle = createApp({
      ...appDefaults(),
      store,
      clientDir: join(root, 'client'),
      beta: { editor: true, malleable: false },
      editing: { enabled: true },
      devIndexHtml: (url) => {
        transformedUrl = url;
        return Promise.resolve(
          '<!doctype html><html><head><meta name="app-base" content="" /><meta name="app-profiles" content="" /><meta name="app-beta" content="" /><meta name="app-editing" content="" /></head><body></body></html>',
        );
      },
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no port');

    const response = await fetch(`http://127.0.0.1:${address.port}/`, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(200);
    expect(transformedUrl).toBe('/');
    const html = await response.text();
    expect(html).toContain(
      '<meta name="app-profiles" content="[{&quot;id&quot;:&quot;triage&quot;,&quot;label&quot;:&quot;Triage&quot;,&quot;order&quot;:0}]" />',
    );
    expect(html).toContain('<meta name="app-beta" content="editor" />');
    expect(html).toContain('<meta name="app-editing" content="on" />');
  });
});
