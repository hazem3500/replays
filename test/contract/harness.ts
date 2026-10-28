import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach } from 'vitest';

import { createApp, type AppOptions } from '../../src/server/app.ts';
import { ReplayStore } from '../../src/server/store.ts';
import { createTestClient, type TestClient } from '../../src/server/testing/client.ts';
import { appDefaults } from '../fixtures.ts';

/**
 * The HTTP contract (docs/api-stability.md: "HTTP API … changes are additive") as golden responses. The same suite runs
 * against every mount of the app (REPLAYS_CONTRACT_MOUNT): today's Node handler, later `createApp().fetch` and the CI-only
 * TanStack Start mount, so the final migration is measured, not hoped for.
 */
export const MOUNT = process.env.REPLAYS_CONTRACT_MOUNT ?? 'node';

const PINNED_HEADERS = [
  'allow',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-security-policy',
  'content-type',
  'etag',
  'location',
  'vary',
  'x-replay-profile',
  'x-replay-purpose',
] as const;

export interface ContractApp {
  client: TestClient;
  store: ReplayStore;
  root: string;
}

export async function startContract(options: Partial<AppOptions> = {}): Promise<ContractApp> {
  const root = await mkdtemp(join(tmpdir(), 'replays-contract-'));
  const store = options.store ?? new ReplayStore(join(root, 'data'), join(root, 'sample'));
  await mkdir(join(root, 'client'), { recursive: true });
  await writeFile(
    join(root, 'client', 'index.html'),
    '<!doctype html><html><head><meta name="app-base" content="" /><title>__PRODUCT_NAME__</title></head><body></body></html>',
  );
  const handle = createApp({ ...appDefaults(), clientDir: join(root, 'client'), ...options, store });
  if (MOUNT !== 'node') throw new Error(`unknown contract mount ${MOUNT}`);
  return { client: await createTestClient(handle), store, root };
}

const HOUR = 60 * 60_000;
/** The response fields the server sets from its own clock; everything else (fixture dates included) stays literal. */
const CLOCK_KEYS = new Set(['at', 'expiresAt']);

/** A clock-derived timestamp as `<now>`, or `<now+30d>` for a retention deadline. */
function relativeTime(value: string) {
  const offset = Date.parse(value) - Date.now();
  if (Math.abs(offset) < 6 * HOUR) return '<now>';
  const days = Math.round(offset / (24 * HOUR));
  return `<now${days < 0 ? '' : '+'}${days}d>`;
}

const isTimestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value);

function normalize(value: unknown, key = ''): unknown {
  if (isTimestamp(value) && CLOCK_KEYS.has(key)) return relativeTime(value);
  if (key === 'core' && typeof value === 'string') return '<version>';
  if (Array.isArray(value)) return value.map((entry) => normalize(entry));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, normalize(entry, name)]));
  return value;
}

/** What a client can rely on: status, the pinned headers (ETag values reduced to their form) and the body. */
export async function capture(response: Response) {
  const headers: Record<string, string> = {};
  for (const name of PINNED_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = name === 'etag' ? value.replace(/"[^"]*"/, '"<etag>"') : value;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString('utf8');
  const type = response.headers.get('content-type') ?? '';
  let body: unknown = text;
  if (type.includes('json') && text) body = normalize(JSON.parse(text));
  else if (type.includes('text/html')) body = { html: text.length > 0 };
  else if (!type.startsWith('text/') || text.length > 240)
    body = bytes.length ? { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16) } : '';
  return { status: response.status, headers, body };
}

export const jsonInit = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

/** A `boot(options)` for one test file: each call starts an app, and every app started is closed after its test. */
export function contractApps() {
  const apps: ContractApp[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.client.close()));
  });
  return async (options: Partial<AppOptions> = {}) => {
    const app = await startContract(options);
    apps.push(app);
    return app;
  };
}
