import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, resolvePlugins } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import type { Identity, WebAuthAdapter } from '../src/server/auth/types.ts';
import { ReplayStore } from '../src/server/store.ts';
import { createTestClient, describeAuthAdapter, type TestClient } from '../src/server/testing/index.ts';
import { appDefaults } from './fixtures.ts';

const TOKENS = new Map<string, Identity>([
  ['Bearer ada', { id: 'ada' }],
  ['Bearer ci', { id: 'ci-bot', authScopes: ['replays:upload'] }],
]);

const bearer: WebAuthAdapter = {
  name: 'web-bearer',
  routes: ['/auth/hello'],
  authenticateRequest: (request) => TOKENS.get(request.headers.get('authorization') ?? ''),
  handleRequest: (request) => (new URL(request.url).pathname === '/auth/hello' ? new Response('hello') : undefined),
  loginUrlFor: () => '/auth/login',
};

describeAuthAdapter(
  'web-bearer',
  {
    create: () => bearer,
    accepts: [{ title: 'a bearer token', request: { headers: { authorization: 'Bearer ada' } }, id: 'ada' }],
    refuses: [{ title: 'no header', request: {} }],
  },
  { describe, it },
);

describe('a web-standard auth adapter', () => {
  const clients: TestClient[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function boot() {
    const root = await mkdtemp(join(tmpdir(), 'replays-web-auth-'));
    const store = new ReplayStore(join(root, 'data'), join(root, 'sample'));
    const client = await createTestClient(createApp({ ...appDefaults(), auth: bearer, store, clientDir: join(root, 'client') }));
    clients.push(client);
    return client;
  }

  it('signs a request in through authenticateRequest', async () => {
    const client = await boot();
    const me = await client.fetch('/api/me', { headers: { authorization: 'Bearer ada' } });
    expect(await me.json()).toEqual({ id: 'ada' });
  });

  it('keeps the scopes of the identity it returns', async () => {
    const client = await boot();
    expect((await client.fetch('/api/replays', { headers: { authorization: 'Bearer ci' } })).status).toBe(403);
  });

  it('answers its own routes before authentication', async () => {
    const client = await boot();
    expect(await (await client.fetch('/auth/hello')).text()).toBe('hello');
  });

  it('sends a browser page load without an identity to loginUrlFor', async () => {
    const client = await boot();
    const page = await client.fetch('/r/demo', { headers: { accept: 'text/html' }, redirect: 'manual' });
    expect([page.status, page.headers.get('location')]).toEqual([302, '/auth/login']);
  });

  it('can be registered by a plugin', async () => {
    const registry = await resolvePlugins([definePlugin({ name: 'acme-auth', setup: (api) => api.auth(bearer) })]);
    expect([...registry.auth.keys()]).toEqual(['web-bearer']);
  });
});
