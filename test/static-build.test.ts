import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin } from '../src/plugin/define.ts';
import type { LoadedConfig } from '../src/config/index.ts';
import { createApp } from '../src/server/app.ts';
import { loadSettings } from '../src/server/config.ts';
import { renderIndexHtml } from '../src/server/index-page.ts';
import { buildStatic } from '../src/server/static.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';

const INDEX = [
  '<!doctype html><html><head>',
  '<meta name="theme-color" content="#0c0e12" data-dark="#0c0e12" data-light="#eff1f5" />',
  '<meta name="app-base" content="" /><meta name="app-beta" content="" /><meta name="app-comments" content="" />',
  '<meta name="app-plugins" content="" /><meta name="app-purposes" content="" /><meta name="app-editing" content="" />',
  '<meta name="app-sign-in" content="" />',
  '<meta name="app-name" content="__PRODUCT_NAME__" /><meta name="app-logo" content="__PRODUCT_LOGO__" />',
  '<title>__PRODUCT_NAME__</title><link rel="modulepreload" href="./assets/react.js" /><script type="module" src="./assets/main.js"></script>',
  '</head><body></body></html>',
].join('');

const FILE = {
  name: 'Acme Replays',
  logoUrl: 'https://example.com/logo.svg',
  basePath: '/replays',
  theme: { dark: { accent: '#ff6600', page: '#101820' }, light: { page: '#fafaf5' } },
};

const config = (file: LoadedConfig['file'] = FILE): LoadedConfig => ({ dir: tmpdir(), file, plugins: [] });

async function builtViewer() {
  const clientDir = await mkdtemp(join(tmpdir(), 'replays-static-client-'));
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await writeFile(join(clientDir, 'index.html'), INDEX);
  await writeFile(join(clientDir, 'render.html'), '<!doctype html><title>render</title>');
  await writeFile(join(clientDir, 'assets', 'main.js'), 'console.log(1)');
  await writeFile(join(clientDir, 'assets', 'react.js'), 'console.log(2)');
  return clientDir;
}

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('replays build-static', () => {
  it('stamps explicit recovery without constructing a secret-dependent adapter', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-sign-in-'));
    const options = { out, clientDir, env: {}, config: config({ ...FILE, auth: 'missing-proxy', signIn: { path: '/api/sign-in' } }) };
    await buildStatic(options);
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<meta name="app-sign-in" content="/replays/api/sign-in" />');
    await buildStatic({ ...options, base: '/' });
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<meta name="app-sign-in" content="/api/sign-in" />');
  });

  it('copies the viewer and stamps base, name, logo, tokens and theme-color into index.html', async () => {
    const clientDir = await builtViewer();
    const out = join(await mkdtemp(join(tmpdir(), 'replays-static-out-')), 'site');
    const built = await buildStatic({ out, clientDir, env: {}, config: config() });
    expect(built.base).toBe('/replays');
    expect(built.files).toEqual(['assets/main.js', 'assets/react.js', 'index.html']);
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<meta name="app-base" content="/replays" />');
    expect(html).toContain('src="/replays/assets/main.js"');
    expect(html).toContain('href="/replays/assets/react.js"');
    expect(html).toContain('<title>Acme Replays</title>');
    expect(html).toContain('<meta name="app-logo" content="https://example.com/logo.svg" />');
    expect(html).toContain(
      '<style id="brand-tokens">:root{--accent:#ff6600;--page:#101820}:root[data-theme="light"]{--page:#fafaf5}</style>',
    );
    expect(html).toContain('<meta name="theme-color" content="#101820" data-dark="#101820" data-light="#fafaf5" />');
    // Comments are on by default, the beta features off: the same flags the server would write.
    expect(html).toContain('<meta name="app-comments" content="on" />');
    expect(html).toContain('<meta name="app-beta" content="" />');
    expect(await readFile(join(out, 'assets', 'main.js'), 'utf8')).toBe('console.log(1)');
    await expect(readFile(join(out, 'render.html'))).rejects.toThrow(/ENOENT/);
  });

  it('stamps config and plugin purposes into the static index', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-purposes-'));
    await buildStatic({
      out,
      clientDir,
      env: {},
      config: config({ purposes: [{ id: 'demo', label: 'Demo' }] }),
      plugins: [
        definePlugin({
          name: 'triage',
          setup(api) {
            api.purpose({ id: 'triage', label: 'Triage' });
          },
        }),
      ],
    });
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('&quot;id&quot;:&quot;demo&quot;');
    expect(html).toContain('&quot;id&quot;:&quot;triage&quot;');
  });

  it('takes --base over the configured one, and copies render.html only when asked', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-out-'));
    const built = await buildStatic({ out, clientDir, env: {}, config: config(), base: '/', includeRender: true });
    expect(built.base).toBe('');
    expect(built.files).toContain('render.html');
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<meta name="app-base" content="/" />');
    expect(html).toContain('src="/assets/main.js"');
    // A later build without it removes the old copy.
    await buildStatic({ out, clientDir, env: {}, config: config(), base: '/' });
    await expect(readFile(join(out, 'render.html'))).rejects.toThrow(/ENOENT/);
  });

  it('applies the environment over the config, like the server', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-out-'));
    await buildStatic({
      out,
      clientDir,
      env: { PRODUCT_NAME: 'From Env', BASE_PATH: '/env', REPLAYS_COMMENTS: 'false' },
      config: config(),
    });
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<title>From Env</title>');
    expect(html).toContain('<meta name="app-base" content="/env" />');
    expect(html).toContain('<meta name="app-comments" content="" />');
  });

  it('refuses a bad base, a missing build and an --out inside the build', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-out-'));
    await expect(buildStatic({ out, clientDir, env: {}, config: config(), base: 'nope' })).rejects.toThrow(/BASE_PATH/);
    await expect(buildStatic({ out, clientDir: join(clientDir, 'missing'), env: {}, config: config() })).rejects.toThrow(/no built viewer/);
    await expect(buildStatic({ out: clientDir, clientDir, env: {}, config: config() })).rejects.toThrow(/outside/);
    await expect(buildStatic({ out: join(clientDir, 'x'), clientDir, env: {}, config: config() })).rejects.toThrow(/outside/);
  });

  it('writes exactly the index.html the server sends for the same settings', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-out-'));
    await buildStatic({ out, clientDir, env: {}, config: config() });
    const settings = await loadSettings({}, FILE);
    const root = await mkdtemp(join(tmpdir(), 'replays-static-server-'));
    const handle = createApp({
      ...appDefaults(),
      branding: settings.branding,
      basePath: settings.basePath,
      comments: settings.comments,
      beta: settings.beta,
      store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
      clientDir,
    });
    const server = createServer((request, response) => void handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const served = await (await fetch(`http://127.0.0.1:${port}/replays/`, { headers: { accept: 'text/html' } })).text();
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe(served);
    expect(served).toBe(
      renderIndexHtml(INDEX, { base: '/replays', branding: settings.branding, beta: settings.beta, comments: settings.comments.enabled }),
    );
  });
});

describe('static viewer editing write policy', () => {
  it('uses the same write policy as the server and keeps the beta editor active for reads', async () => {
    const clientDir = await builtViewer();
    const out = await mkdtemp(join(tmpdir(), 'replays-static-editing-'));
    for (const [beta, enabled, expected] of [
      [true, false, 'off'],
      [true, true, 'on'],
      [false, true, 'off'],
    ] as const) {
      await buildStatic({ out, clientDir, env: {}, config: config({ beta: { editor: beta }, editing: { enabled } }) });
      const html = await readFile(join(out, 'index.html'), 'utf8');
      expect(html).toContain(`<meta name="app-editing" content="${expected}" />`);
      expect(html).toContain(`<meta name="app-beta" content="${beta ? 'editor' : ''}" />`);
    }
  });
});
