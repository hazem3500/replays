import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, resolvePlugins, type PluginApi } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertUploadBundle } from '../src/server/upload-validation.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

async function start(setup: (api: PluginApi) => void = () => {}) {
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples');
  const plugins = await resolvePlugins([definePlugin({ name: 'envelope-test', setup })]);
  const app = createApp({ ...appDefaults(), store, plugins, clientDir: '/nonexistent-client' });
  const server = createServer((request, response) => void app(request, response));
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const post = (body: unknown, path = '/api/replays') =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { store, post };
}

describe('upload envelope', () => {
  it.each(['id', 'title', 'url', 'capturedAt', 'duration', 'viewport', 'eventCount', 'version'])(
    'rejects missing meta.%s before hooks and persistence',
    async (field) => {
      const calls: string[] = [];
      const { post, store } = await start((api) => {
        api.prepareUpload(({ body }) => {
          calls.push('prepare');
          return body;
        });
        api.contextAdapter({
          name: 'check',
          normalize: (context) => {
            calls.push('context');
            return context;
          },
        });
        api.beforeUpload(() => {
          calls.push('before');
        });
      });
      const value = replay();
      delete (value.meta as unknown as Record<string, unknown>)[field];
      const response = await post(value);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(field);
      expect(calls).toEqual([]);
      expect(await store.list()).toEqual([]);
    },
  );

  it.each([
    ['url', { ...replay(), meta: { ...replay().meta, url: 3 } }],
    ['capturedAt', { ...replay(), meta: { ...replay().meta, capturedAt: 'yesterday' } }],
    ['viewport', { ...replay(), meta: { ...replay().meta, viewport: { width: 100 } } }],
    ['events', { ...replay(), events: [null, {}] }],
    ['console', { ...replay(), console: [null] }],
    ['network', { ...replay(), network: [null] }],
    ['steps', { ...replay(), steps: [null] }],
    ['sources', { ...replay(), context: { version: 1, capturedAt: 'now', sources: [null] } }],
  ])('rejects malformed %s with 400', async (_field, value) => {
    const { post, store } = await start();
    const response = await post(value);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('replay');
    expect(await store.list()).toEqual([]);
  });

  it('validates alias output before global hooks and validates hook replacements again', async () => {
    const calls: string[] = [];
    const { post, store } = await start((api) => {
      api.uploadEndpoint({ path: '/api/foreign', prepare: ({ body }) => (body as { recording: unknown }).recording });
      api.prepareUpload(({ body }) => {
        calls.push('prepare');
        return { ...(body as object), network: [null] };
      });
    });
    const invalid = replay();
    delete (invalid.meta as unknown as Record<string, unknown>).url;
    expect((await post({ recording: invalid }, '/api/foreign')).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await post({ recording: replay() }, '/api/foreign')).status).toBe(400);
    expect(calls).toEqual(['prepare']);
    expect(await store.list()).toEqual([]);
  });

  it('checks beforeUpload replacements against the complete stored schema', async () => {
    const { post, store } = await start((api) => {
      api.beforeUpload(({ bundle }) => ({ ...bundle, meta: { ...bundle.meta, url: 3 } }) as never);
    });
    expect((await post(replay())).status).toBe(400);
    expect(await store.list()).toEqual([]);
  });

  it('retains valid uploads and the existing source translation hook', async () => {
    const { post, store } = await start((api) => {
      api.prepareUpload(({ body }) => ({ ...(body as object), meta: { ...(body as ReturnType<typeof replay>).meta, source: 'agent' } }));
    });
    expect((await post({ ...replay(), meta: { ...replay().meta, source: 'legacy-runner' } })).status).toBe(201);
    expect(await store.list()).toHaveLength(1);
    expect(() => assertUploadBundle(replay())).not.toThrow();
  });
});
