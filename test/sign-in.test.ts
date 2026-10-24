import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeSignIn, signInReturn } from '../src/shared/sign-in.ts';
import { fetchPage, redirectToSignIn, signedOut, signInHref, SignInError } from '../src/client/sign-in.tsx';
import { createApp } from '../src/server/app.ts';
import { ReplayStore } from '../src/server/store.ts';
import { appDefaults } from './fixtures.ts';
import { renderIndexHtml } from '../src/server/index-page.ts';
import { loadSettings } from '../src/server/config.ts';
import { resolvePluginsSync } from '../src/plugin/registry.ts';

function page() {
  const assign = vi.fn<(url: string) => void>();
  const store = new Map<string, string>();
  vi.stubGlobal('location', { pathname: '/tools/r/x', search: '?t=2.5', hash: '#step-2', assign });
  vi.stubGlobal('document', {
    querySelector: (selector: string) => ({ content: selector.includes('app-base') ? '/tools' : '/tools/api/sign-in' }),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  return assign;
}
afterEach(() => vi.unstubAllGlobals());

describe('sign-in safety and configuration', () => {
  it('normalizes returns before checking for protocol-relative redirects', () => {
    expect(signInReturn('/tools/r/x?t=2.5#step-2', '/tools/')).toBe('/tools/r/x?t=2.5#step-2');
    for (const next of [
      null,
      '',
      'r/x',
      '//evil.example/r',
      '/\\evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      '/.//evil.example',
      '/a/..//evil.example/x',
      '/%2e//evil.example',
      '/./\\evil.example',
    ])
      expect([next, signInReturn(next, '/tools/')]).toEqual([next, '/tools/']);
  });
  it('validates dedicated endpoints and config, including static metadata', async () => {
    for (const path of ['/api/replays', '/internal/render/x', '//evil.example', '/auth/a/../b', '/auth/a?x=1'])
      expect(() => normalizeSignIn({ path })).toThrow('signIn.path');
    expect(normalizeSignIn(false)).toBeUndefined();
    await expect(loadSettings({}, { signIn: { path: '//evil.example' } })).rejects.toThrow('signIn.path');
    const html = renderIndexHtml('<meta name="app-sign-in" content="" />', {
      base: '/tools',
      branding: { name: 'Example' },
      signIn: { path: '/api/sign-in' },
    });
    expect(html).toContain('content="/tools/api/sign-in"');
  });
});

describe('browser page recovery', () => {
  it('probes manually, recognizing opaque redirects and 401 but preserving network failures', async () => {
    page();
    const probe = vi.fn<() => Promise<Partial<Response>>>().mockResolvedValue({ type: 'opaqueredirect', status: 0 });
    vi.stubGlobal('fetch', probe);
    expect(await signedOut()).toBe(true);
    expect(probe).toHaveBeenCalledWith(
      '/tools/api/me',
      expect.objectContaining({ redirect: 'manual', cache: 'no-store', headers: { 'x-requested-with': 'XMLHttpRequest' } }),
    );
    probe.mockResolvedValue({ type: 'basic', status: 401 });
    expect(await signedOut()).toBe(true);
    probe.mockResolvedValue({ type: 'basic', status: 200 });
    expect(await signedOut()).toBe(false);
    probe.mockRejectedValue(new TypeError('offline'));
    expect(await signedOut()).toBe(false);
  });
  it('classifies failed page reads without navigating (including aborted reads)', async () => {
    const assign = page();
    const offline = new TypeError('offline');
    const fetch = vi.fn<() => Promise<Partial<Response>>>().mockRejectedValueOnce(offline).mockResolvedValueOnce({ status: 401 });
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPage('/tools/api/replays/x')).rejects.toBeInstanceOf(SignInError);
    expect(assign).not.toHaveBeenCalled();
    fetch.mockRejectedValue(offline);
    await expect(fetchPage('/tools/api/replays/x')).rejects.toBe(offline);
    const controller = new AbortController();
    controller.abort();
    fetch.mockClear();
    await expect(fetchPage('/tools/api/replays/x', { signal: controller.signal })).rejects.toBe(offline);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal('document', { querySelector: () => null });
    fetch.mockResolvedValue({ status: 401 });
    expect((await fetchPage('/tools/api/me')).status).toBe(401);
  });
  it('preserves the full return address, bounds attempts, and leaves storage failures manual', () => {
    const assign = page();
    expect(signInHref()).toBe('/tools/api/sign-in?next=%2Ftools%2Fr%2Fx%3Ft%3D2.5%23step-2');
    expect(redirectToSignIn(1_000_000)).toBe(true);
    expect(redirectToSignIn(1_030_000)).toBe(false);
    expect(redirectToSignIn(1_061_000)).toBe(true);
    expect(assign).toHaveBeenCalledTimes(2);
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('unavailable');
      },
    });
    expect(redirectToSignIn(2_000_000)).toBe(false);
    expect(signInHref()).toBeTruthy();
  });
});

it('authenticates the return endpoint, respects the host base, and never redirects ordinary APIs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replays-sign-in-'));
  const handle = createApp({
    ...appDefaults(),
    basePath: '/tools',
    hosts: { 'root.localhost': { basePath: '/' } },
    auth: {
      name: 'proxy',
      signIn: { path: '/api/sign-in' },
      authenticate: (request) => (request.headers['x-test-user'] ? { id: 'staff' } : undefined),
    },
    store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
    clientDir: join(root, 'client'),
    plugins: resolvePluginsSync([
      {
        name: 'route-scope',
        apiVersion: 1,
        setup(api) {
          api.onRequest(({ request, response }) => {
            if (request.headers['x-restricted']) {
              response.writeHead(403);
              response.end('restricted');
              return true;
            }
          });
        },
      },
    ]),
  });
  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const call = (path: string, headers: Record<string, string> = { 'x-test-user': 'yes' }, method = 'GET') =>
      fetch(`${origin}${path}`, { redirect: 'manual', headers, method });
    expect((await call('/tools/api/sign-in', {})).status).toBe(403);
    expect((await call('/tools/api/sign-in', { 'x-test-user': 'yes', 'x-restricted': 'yes' })).status).toBe(403);
    expect((await (await call('/tools/api/config')).json()).signIn).toEqual({ path: '/api/sign-in' });
    const result = await call('/tools/api/sign-in?next=%2Ftools%2Fr%2Fx%3Ft%3D2%23step');
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/tools/r/x?t=2#step');
    expect(result.headers.get('cache-control')).toBe('no-store');
    for (const next of ['/.//evil.example', '/tools/api/sign-in', '/tools/api/replays', '/internal/render/x']) {
      expect((await call(`/tools/api/sign-in?next=${encodeURIComponent(next)}`)).headers.get('location')).toBe('/tools/');
    }
    expect((await call('/tools/api/sign-in?next=%2Fr%2Fx', { 'x-test-user': 'yes', host: 'root.localhost' })).headers.get('location')).toBe(
      '/r/x',
    );
    for (const [path, method] of [
      ['/tools/api/me', 'GET'],
      ['/tools/api/replays', 'POST'],
      ['/internal/render/x', 'GET'],
    ]) {
      const response = await call(path!, {}, method);
      expect(response.headers.get('location')).toBeNull();
    }
    expect((await call('/tools/api/sign-in', undefined, 'POST')).status).toBe(405);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
