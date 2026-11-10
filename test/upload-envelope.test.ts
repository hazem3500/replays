import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { definePlugin, resolvePlugins, type PluginApi } from '../src/plugin/index.ts';
import { createApp } from '../src/server/app.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertUploadBundle } from '../src/server/upload-validation.ts';
import { REPLAY_FORMAT_VERSION } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const servers: Array<ReturnType<typeof createServer>> = [];

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((done) => server.close(() => done()));
}

async function closeServers() {
  await Promise.all(servers.splice(0).map(closeServer));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merged(body: unknown, extra: Record<string, unknown>) {
  return { ...(isRecord(body) ? body : {}), ...extra };
}

function withoutMeta(field: string) {
  const value = replay();
  return { ...value, meta: Object.fromEntries(Object.entries(value.meta).filter(([key]) => key !== field)) };
}

function trackingPlugin(calls: string[]) {
  return (api: PluginApi) => {
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
  };
}

function foreignAliasPlugin(calls: string[]) {
  return (api: PluginApi) => {
    api.uploadEndpoint({ path: '/api/foreign', prepare: ({ body }) => (isRecord(body) ? body.recording : undefined) });
    api.prepareUpload(({ body }) => {
      calls.push('prepare');
      return merged(body, { network: [null] });
    });
  };
}

function invalidBeforeUploadPlugin(api: PluginApi) {
  api.beforeUpload(({ bundle }) => Object.assign({}, bundle, { meta: Object.assign({}, bundle.meta, { url: 3 }) }));
}

function sourceTranslationPlugin(api: PluginApi) {
  api.prepareUpload(({ body }) => merged(body, { meta: { ...replay().meta, source: 'agent' } }));
}

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
  afterEach(closeServers);

  it.each(['id', 'title', 'url', 'capturedAt', 'duration', 'viewport', 'eventCount', 'version'])(
    'rejects missing meta.%s before hooks and persistence',
    async (field) => {
      const calls: string[] = [];
      const { post, store } = await start(trackingPlugin(calls));
      const response = await post(withoutMeta(field));
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

  it('names the server format on a rejection and refuses a newer bundle format', async () => {
    const { post, store } = await start();
    const response = await post({ ...replay(), meta: { ...replay().meta, formatVersion: 99 } });
    expect(response.status).toBe(400);
    expect(response.headers.get('x-replays-format')).toBe(String(REPLAY_FORMAT_VERSION));
    expect(await response.text()).toContain('replay.meta.formatVersion');
    expect(await store.list()).toEqual([]);
    expect((await post({ ...replay(), meta: { ...replay().meta, formatVersion: REPLAY_FORMAT_VERSION } })).status).toBe(201);
  });

  it('validates alias output before global hooks and validates hook replacements again', async () => {
    const calls: string[] = [];
    const { post, store } = await start(foreignAliasPlugin(calls));
    expect((await post({ recording: withoutMeta('url') }, '/api/foreign')).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await post({ recording: replay() }, '/api/foreign')).status).toBe(400);
    expect(calls).toEqual(['prepare']);
    expect(await store.list()).toEqual([]);
  });

  it('checks beforeUpload replacements against the complete stored schema', async () => {
    const { post, store } = await start(invalidBeforeUploadPlugin);
    expect((await post(replay())).status).toBe(400);
    expect(await store.list()).toEqual([]);
  });

  it('retains valid uploads and the existing source translation hook', async () => {
    const { post, store } = await start(sourceTranslationPlugin);
    expect((await post({ ...replay(), meta: { ...replay().meta, source: 'legacy-runner' } })).status).toBe(201);
    expect(await store.list()).toHaveLength(1);
    expect(() => assertUploadBundle(replay())).not.toThrow();
  });
});
