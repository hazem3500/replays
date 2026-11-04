import { createServer } from 'node:http';

import { describe, expect, it, onTestFinished } from 'vitest';

import { sanitizeReplayBundle, type SanitizeReplayOptions } from '../src/capture/index.ts';
import { definePlugin, resolvePlugins } from '../src/plugin/index.ts';
import { createApp, type AppOptions } from '../src/server/app.ts';
import type { AuthAdapter } from '../src/server/auth/types.ts';
import { MemoryStorage } from '../src/server/storage/index.ts';
import { ReplayStore } from '../src/server/store.ts';
import { assertCaptured, type CapturedChoice } from '../src/shared/capture-profile.ts';
import type { ReplayBundle, ReplayCaptured } from '../src/shared/replay.ts';
import { isRecord } from '../src/shared/validate.ts';
import { appDefaults, replay } from './fixtures.ts';

const KEEP: SanitizeReplayOptions = { keepCustomerChoices: true };
/** Secrets no upload may store, whatever it claims and whatever the host opted into. */
const ALWAYS_GONE = ['pw-secret', 'csrf-secret', 'auth-secret', 'urlpass-secret', 'tok-secret', 'body-pw-secret', 'body-token-secret'];
const CHOSE_ALL: CapturedChoice = { by: 'customer', mode: 'visible', inputs: 'visible', text: 'visible', bodies: true };

const input = (id: number, type: string, value: string) => ({ type: 2, id, tagName: 'input', attributes: { type, value }, childNodes: [] });

/** A customer recording: a typed name, a password, a CSRF token, page text and one request with bodies and credentials. */
function customerForm(captured: { [K in keyof ReplayCaptured]?: ReplayCaptured[K] | undefined } = {}, id = 'customer-form'): ReplayBundle {
  const bundle = replay(id);
  const full = { console: true, network: 'bodies', performance: false, video: false, inputs: 'visible', choice: CHOSE_ALL, ...captured };
  // why: an override of `undefined` removes the key, as a recorder that never wrote it would.
  const kept = Object.fromEntries(Object.entries(full).filter(([, value]) => value !== undefined));
  assertCaptured(kept);
  bundle.meta.captured = kept;
  const page = { type: 2, id: 5, tagName: 'p', attributes: {}, childNodes: [{ type: 3, id: 6, textContent: 'Order for Ada' }] };
  const fields = [input(2, 'text', 'Ada Lovelace'), input(3, 'password', 'pw-secret'), input(4, 'hidden', 'csrf-secret')];
  bundle.events = [
    { type: 4, timestamp: 1000 },
    { type: 2, timestamp: 2000, data: { node: { type: 0, id: 1, childNodes: [...fields, page] } } },
  ];
  bundle.network = [
    {
      id: 'request-1',
      at: 10,
      duration: 5,
      method: 'POST',
      url: 'https://shopper:urlpass-secret@api.example.com/cart?access_token=tok-secret',
      status: 200,
      statusText: 'OK',
      mimeType: 'application/json',
      requestHeaders: [
        { name: 'authorization', value: 'Bearer auth-secret' },
        { name: 'content-type', value: 'application/json' },
      ],
      responseHeaders: [],
      requestBody: { text: '{"item":"Notebook","password":"body-pw-secret"}' },
      responseBody: { text: '{"total":"12 EUR","token":"body-token-secret"}' },
    },
  ];
  return bundle;
}

/** What a stored bundle still shows of the customer's choice, and every always-redacted secret it leaked. */
function exposed(bundle: ReplayBundle) {
  const serialized = JSON.stringify(bundle);
  const kept = [
    serialized.includes('Ada Lovelace') && 'typed name',
    serialized.includes('Notebook') && 'request body',
    serialized.includes('12 EUR') && 'response body',
  ].filter((item) => item !== false);
  return { kept, leaked: ALWAYS_GONE.filter((secret) => serialized.includes(secret)) };
}

describe('customer choices in the privacy pass', () => {
  it('keeps exactly what the customer chose when the host opted in and the claim matches', () => {
    expect(exposed(sanitizeReplayBundle(customerForm(), undefined, KEEP))).toEqual({
      kept: ['typed name', 'request body', 'response body'],
      leaked: [],
    });
  });

  it.each([
    ['typed values only', { network: 'headers', choice: { ...CHOSE_ALL, bodies: false } }, ['typed name']],
    ['bodies only', { inputs: undefined, choice: { ...CHOSE_ALL, inputs: 'masked' } }, ['request body', 'response body']],
    [
      'the default, interface text only',
      {
        network: 'headers',
        inputs: undefined,
        choice: { ...CHOSE_ALL, mode: 'interface-visible', inputs: 'masked', text: 'masked', bodies: false },
      },
      [],
    ],
  ] as const)('keeps only the chosen fields when the customer chose %s', (_name, captured, kept) => {
    expect(exposed(sanitizeReplayBundle(customerForm(captured), undefined, KEEP)).kept).toEqual(kept);
  });

  it('masks every input and drops every body without the host opt-in, even with staff visible inputs allowed', () => {
    const clean = sanitizeReplayBundle(customerForm(), undefined, { keepVisibleInputs: true });
    expect(exposed(clean)).toEqual({ kept: [], leaked: [] });
    expect(clean.meta.captured).toEqual({
      console: true,
      network: 'headers',
      performance: false,
      video: false,
      choice: { by: 'customer', mode: 'visible', inputs: 'masked', text: 'visible', bodies: false },
    });
  });

  it.each([
    ['bodies while the network says headers', { network: 'headers' }],
    ['typed values the bundle does not declare visible', { inputs: undefined }],
    ['masked values the bundle declares visible', { choice: { ...CHOSE_ALL, inputs: 'masked' } }],
    ['no bodies while the network says bodies', { choice: { ...CHOSE_ALL, bodies: false } }],
    ['typed values under a mode that never shows them', { choice: { ...CHOSE_ALL, mode: 'interface-visible' } }],
  ] as const)('masks everything for a claim of %s', (_name, captured) => {
    expect(exposed(sanitizeReplayBundle(customerForm(captured), undefined, KEEP))).toEqual({ kept: [], leaked: [] });
  });

  it('masks every input of a bundle without a customer claim, even with the host opt-in', () => {
    const unclaimed = customerForm({ choice: undefined });
    expect(sanitizeReplayBundle(unclaimed, undefined, KEEP)).toEqual(sanitizeReplayBundle(customerForm({ choice: undefined })));
    expect(exposed(sanitizeReplayBundle(unclaimed, undefined, KEEP)).kept).not.toContain('typed name');
  });

  it('leaves page text as the recorder sent it, with the host’s mask selectors still applied', () => {
    expect(JSON.stringify(sanitizeReplayBundle(customerForm(), undefined, KEEP))).toContain('Order for Ada');
    expect(JSON.stringify(sanitizeReplayBundle(customerForm(), { maskSelectors: ['p'] }, KEEP))).not.toContain('Order for Ada');
  });

  it('changes nothing on a second pass, with or without the opt-in', () => {
    const kept = sanitizeReplayBundle(customerForm(), undefined, KEEP);
    expect(sanitizeReplayBundle(structuredClone(kept), undefined, KEEP)).toEqual(kept);
    const masked = sanitizeReplayBundle(customerForm());
    expect(sanitizeReplayBundle(structuredClone(masked), undefined, KEEP)).toEqual(masked);
  });
});

const appKey = (request: { headers: Record<string, unknown> }) =>
  request.headers['x-app-key'] === 'key-1' ? { id: 'app:shop' } : undefined;
const staff: AuthAdapter = {
  name: 'staff',
  authenticate: (request) => (request.headers['x-staff'] ? { id: 'staff@example.com', email: 'staff@example.com' } : undefined),
};
const INGEST = '/api/ingest/v1/recordings';

async function start(options: Partial<AppOptions>) {
  const store = new ReplayStore(new MemoryStorage(), '/nonexistent-samples');
  const plugins = await resolvePlugins([
    definePlugin({ name: 'host', setup: (api) => api.uploadEndpoint({ path: INGEST, authenticate: appKey }) }),
  ]);
  const app = createApp({ ...appDefaults(), auth: staff, store, plugins, clientDir: '/nonexistent-client', ...options });
  const server = createServer((req, res) => void app(req, res));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const post = (path: string, headers: Record<string, string>, body: ReplayBundle) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const stored = async (path: string, headers: Record<string, string>, body: ReplayBundle) => {
    const response = await post(path, headers, body);
    expect(response.status).toBe(201);
    const receipt: unknown = await response.json();
    const id = isRecord(receipt) && typeof receipt.id === 'string' ? receipt.id : '';
    const bundle = await store.load(id);
    if (!bundle) throw new Error(`nothing stored for ${id}`);
    return bundle;
  };
  return { store, post, stored };
}

const CUSTOMER = { 'x-app-key': 'key-1' };
/** A staff recording with visible inputs: no customer claim. */
const staffForm = () => customerForm({ choice: undefined, network: 'headers' }, 'staff-form');
const OPTED_IN = { privacy: { keepVisibleInputs: false, keepCustomerChoices: true } };

describe('customer choices on upload', () => {
  it('keeps the chosen typed values and bodies of a customer ingest upload when the host opted in', async () => {
    const { stored } = await start(OPTED_IN);
    expect(exposed(await stored(INGEST, CUSTOMER, customerForm()))).toEqual({
      kept: ['typed name', 'request body', 'response body'],
      leaked: [],
    });
  });

  it('masks a customer ingest upload fully when the host has not opted in', async () => {
    const { stored } = await start({});
    expect(exposed(await stored(INGEST, CUSTOMER, customerForm()))).toEqual({ kept: [], leaked: [] });
  });

  it('masks the typed values of a customer ingest upload that carries no claim, even with the host opted in', async () => {
    const { stored } = await start(OPTED_IN);
    expect(exposed(await stored(INGEST, CUSTOMER, customerForm({ choice: undefined }))).kept).not.toContain('typed name');
  });

  it('masks a customer ingest upload fully when its claim asks for more than it captured', async () => {
    const { stored } = await start(OPTED_IN);
    expect(exposed(await stored(INGEST, CUSTOMER, customerForm({ network: 'headers' })))).toEqual({ kept: [], leaked: [] });
  });

  it('refuses an unauthenticated customer upload before storing anything, even with the host opted in', async () => {
    const { store, post } = await start(OPTED_IN);
    expect((await post(INGEST, {}, customerForm())).status).toBeGreaterThanOrEqual(400);
    expect(await store.list()).toEqual([]);
  });

  it('keeps a staff upload’s visible inputs only with the staff opt-in, whatever the customer opt-in says', async () => {
    const customerOnly = await start(OPTED_IN);
    const masked = await customerOnly.stored('/api/replays', { 'x-staff': '1' }, staffForm());
    expect(exposed(masked).kept).not.toContain('typed name');
    const staffOnly = await start({ privacy: { keepVisibleInputs: true, keepCustomerChoices: false } });
    const kept = await staffOnly.stored('/api/replays', { 'x-staff': '1' }, staffForm());
    expect(exposed(kept).kept).toContain('typed name');
    expect(exposed(kept).leaked).toEqual([]);
  });
});
