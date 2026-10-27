import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, resolvePlugins, type PluginApi, type StandardSchemaV1 } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { ReplayStore } from '../src/server/store.ts';
import { createTestClient, type TestClient } from '../src/server/testing/client.ts';
import { appDefaults, replay } from './fixtures.ts';

const closed: AuthAdapter = { name: 'closed', authenticate: (): undefined => {} };

const isNamed = (value: unknown): value is { name: string } =>
  typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string';

/** A hand-written Standard Schema for `{ name: string }`, as Zod 4 or Valibot would provide. */
const named: StandardSchemaV1<unknown, { name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) => (isNamed(value) ? { value: { name: value.name } } : { issues: [{ message: 'must be a string', path: ['name'] }] }),
  },
};

const item = (api: PluginApi) =>
  api.route({
    method: 'GET',
    path: '/api/plugins/acme/items/:id',
    handler: ({ params, identity }) => Response.json({ id: params.id, who: identity?.id }),
  });
const health = (api: PluginApi) =>
  api.route({ method: 'GET', path: '/api/plugins/acme/health', auth: 'none', handler: () => new Response('up') });
const secret = (api: PluginApi) => api.route({ method: 'GET', path: '/api/plugins/acme/secret', handler: () => new Response('no') });
const greet = (api: PluginApi) =>
  api.route({ method: 'POST', path: '/api/plugins/acme/greet', body: named, handler: ({ body }) => new Response(`hi ${body.name}`) });
const ping = (api: PluginApi) =>
  api.route({ method: 'POST', path: '/api/plugins/acme/ping', auth: 'none', handler: () => new Response('pong') });
const outside = (api: PluginApi) => api.route({ method: 'GET', path: '/api/replays', handler: () => new Response('') });
const recordIdentity = (seen: string[]) => (api: PluginApi) =>
  api.middleware({ phase: 'post-auth', handle: ({ identity }) => void seen.push(identity?.id ?? 'none') });
const recordUploadPath = (paths: string[]) => (api: PluginApi) =>
  api.beforeUpload(({ webRequest }) => void paths.push(new URL(webRequest.url).pathname));
const teapot = ({ path }: { path: string }) => (path === '/api/me' ? new Response('intercepted', { status: 418 }) : undefined);

describe('plugin Web API', () => {
  const clients: TestClient[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  async function boot(setup: (api: PluginApi) => void, auth?: AuthAdapter) {
    const root = await mkdtemp(join(tmpdir(), 'replays-web-api-'));
    const app = createApp({
      ...appDefaults(),
      ...(auth ? { auth } : {}),
      store: new ReplayStore(join(root, 'data'), join(root, 'sample')),
      clientDir: join(root, 'client'),
      plugins: await resolvePlugins([definePlugin({ name: 'acme', setup })]),
    });
    const client = await createTestClient(app);
    clients.push(client);
    return client;
  }

  it('answers a route with the signed-in identity and its path parameters', async () => {
    const client = await boot(item);
    expect(await (await client.fetch('/api/plugins/acme/items/42')).json()).toEqual({ id: '42', who: 'anonymous' });
  });

  it('answers an auth: none route before authentication', async () => {
    const client = await boot(health, closed);
    expect(await (await client.fetch('/api/plugins/acme/health')).text()).toBe('up');
  });

  it('keeps an auth: required route behind authentication', async () => {
    const client = await boot(secret, closed);
    expect((await client.fetch('/api/plugins/acme/secret')).status).toBe(403);
  });

  it('hands the handler a body that passed its schema', async () => {
    const client = await boot(greet);
    const response = await client.fetch('/api/plugins/acme/greet', { method: 'POST', body: JSON.stringify({ name: 'ada' }) });
    expect(await response.text()).toBe('hi ada');
  });

  it('answers a body that fails its schema with a 400 naming the issue', async () => {
    const client = await boot(greet);
    const response = await client.fetch('/api/plugins/acme/greet', { method: 'POST', body: JSON.stringify({ name: 7 }) });
    expect([response.status, await response.text()]).toEqual([400, 'name: must be a string']);
  });

  it('refuses a cross-site write on an auth: none route', async () => {
    const client = await boot(ping);
    const response = await client.fetch('/api/plugins/acme/ping', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
    expect([response.status, await response.text()]).toEqual([403, 'cross-site request']);
  });

  it('refuses a route outside the plugin namespace at start', async () => {
    await expect(resolvePlugins([definePlugin({ name: 'acme', setup: outside })])).rejects.toThrow(
      /route path must be \/api\/plugins\/acme/,
    );
  });

  it('lets pre-auth middleware answer a request', async () => {
    const client = await boot((api) => api.middleware({ phase: 'pre-auth', handle: teapot }));
    expect([(await client.fetch('/api/me')).status, (await client.fetch('/api/config')).status]).toEqual([418, 200]);
  });

  it('gives post-auth middleware the identity', async () => {
    const seen: string[] = [];
    const client = await boot(recordIdentity(seen));
    await client.fetch('/api/me');
    expect(seen).toEqual(['anonymous']);
  });

  it('gives upload hooks the web request', async () => {
    const paths: string[] = [];
    const client = await boot(recordUploadPath(paths));
    await client.fetch('/api/replays', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(replay('web-hook')),
    });
    expect(paths).toEqual(['/api/replays']);
  });
});
