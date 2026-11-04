import { createServer } from 'node:http';

import { describe, expect, it, onTestFinished } from 'vitest';

import { definePlugin, resolvePlugins, type PluginApi } from '../src/plugin/index.ts';
import { createApp, type AppOptions } from '../src/server/app.ts';
import type { AuthAdapter, Identity } from '../src/server/auth/types.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import type { ReplayBundle } from '../src/shared/replay.ts';
import { appDefaults, replay } from './fixtures.ts';

const OPTED_IN = { privacy: { keepVisibleInputs: true } } satisfies Partial<AppOptions>;
const signedIn = (identity: Identity): AuthAdapter => ({
  name: 'staff',
  authenticate: (request) => (request.headers['x-staff'] ? identity : undefined),
});
const staff = signedIn({ id: 'staff@example.com', email: 'staff@example.com' });

const input = (id: number, type: string, value: string) => ({ type: 2, id, tagName: 'input', attributes: { type, value }, childNodes: [] });
const appKey = (request: { headers: Record<string, unknown> }) =>
  request.headers['x-app-key'] === 'key-1' ? { id: 'app:focus' } : undefined;

/** A recorder bundle made with `privacy.sanitize: false`: a typed name, a password and a CSRF token. */
function staffForm(id = 'staff-form'): ReplayBundle {
  const bundle = replay(id);
  bundle.meta.captured = { console: true, network: 'headers', performance: false, video: false, inputs: 'visible' };
  bundle.events = [
    { type: 4, timestamp: 1000 },
    {
      type: 2,
      timestamp: 2000,
      data: {
        node: {
          type: 0,
          id: 1,
          childNodes: [input(2, 'text', 'Ada Lovelace'), input(3, 'password', 'pw-secret'), input(4, 'hidden', 'csrf-secret')],
        },
      },
    },
  ];
  return bundle;
}

async function start(options: Partial<AppOptions>, setup?: (api: PluginApi) => void) {
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples');
  const plugins = setup ? await resolvePlugins([definePlugin({ name: 'host', setup })]) : undefined;
  const app = createApp({ ...appDefaults(), store, ...(plugins ? { plugins } : {}), clientDir: '/nonexistent-client', ...options });
  const server = createServer((req, res) => void app(req, res));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const post = (path: string, headers: Record<string, string> = {}, body: unknown = staffForm()) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { store, post };
}

/** The stored bundle, serialized, after the upload answered 201. */
async function stored(store: ReplayStore, response: Response) {
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const bundle = await store.load(id);
  if (!bundle) throw new Error(`nothing stored for ${id}`);
  return { bundle, serialized: JSON.stringify(bundle) };
}

/** What a stored bundle still shows of the form: the typed name, the password, the CSRF token and the visible claim. */
function exposed({ bundle, serialized }: { bundle: ReplayBundle; serialized: string }) {
  const values = ['Ada Lovelace', 'pw-secret', 'csrf-secret'].filter((value) => serialized.includes(value));
  return bundle.meta.captured?.inputs ? [...values, `inputs: ${bundle.meta.captured.inputs}`] : values;
}

describe('visible inputs on upload', () => {
  it('keeps a signed-in staff upload’s visible inputs when the host opted in, passwords and hidden inputs masked', async () => {
    const { store, post } = await start({ ...OPTED_IN, auth: staff });
    expect(exposed(await stored(store, await post('/api/replays', { 'x-staff': '1' })))).toEqual(['Ada Lovelace', 'inputs: visible']);
  });

  it('masks every input of a staff upload when the host has not opted in', async () => {
    const { store, post } = await start({ auth: staff });
    expect(exposed(await stored(store, await post('/api/replays', { 'x-staff': '1' })))).toEqual([]);
  });

  it('masks every input on an app-key upload endpoint, even with the host opted in', async () => {
    const { store, post } = await start({ ...OPTED_IN, auth: staff }, (api) =>
      api.uploadEndpoint({ path: '/api/ingest/v1/recordings', authenticate: appKey }),
    );
    expect(exposed(await stored(store, await post('/api/ingest/v1/recordings', { 'x-app-key': 'key-1' })))).toEqual([]);
  });

  it('masks every input on a plugin upload endpoint behind the staff sign-in, such as a support alias', async () => {
    const { store, post } = await start({ ...OPTED_IN, auth: staff }, (api) => api.uploadEndpoint({ path: '/api/support-recordings' }));
    expect(exposed(await stored(store, await post('/api/support-recordings', { 'x-staff': '1' })))).toEqual([]);
  });

  it('masks every input without a real sign-in (auth none)', async () => {
    const { store, post } = await start(OPTED_IN);
    expect(exposed(await stored(store, await post('/api/replays')))).toEqual([]);
  });

  it('masks every input uploaded with a scoped upload token', async () => {
    const { store, post } = await start({ ...OPTED_IN, auth: signedIn({ id: 'cli', authScopes: ['replays:upload'] }) });
    expect(exposed(await stored(store, await post('/api/replays', { 'x-staff': '1' })))).toEqual([]);
  });

  it('masks every input uploaded by an identity confined to the upload route', async () => {
    const confined = signedIn({ id: 'svc', capabilities: { routes: [{ method: 'POST', path: '/api/replays' }] } });
    const { store, post } = await start({ ...OPTED_IN, auth: confined });
    expect(exposed(await stored(store, await post('/api/replays', { 'x-staff': '1' })))).toEqual([]);
  });

  it('refuses an unauthenticated upload that claims visible inputs before storing anything', async () => {
    const { store, post } = await start({ ...OPTED_IN, auth: staff });
    expect((await post('/api/replays')).status).toBe(403);
    expect(await store.list()).toEqual([]);
  });
});
