import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { IDENTITY_HEADER, signIdentity } from '../src/iap.ts';

// Starts the example distribution (src/server.ts → replays.config.ts → the plugin) and proves each extension is live.

const SECRET = 'e2e-signing-secret';
const AUDIENCE = 'acme-replays';
const BASE = '/acme/replays';
const exp = () => Math.floor(Date.now() / 1000) + 600;
const token = (email = 'ada@acme.test', overrides: Partial<Parameters<typeof signIdentity>[0]> = {}, secret = SECRET) =>
  signIdentity({ email, name: 'Ada', aud: AUDIENCE, exp: exp(), ...overrides }, secret);
const asAda = { [IDENTITY_HEADER]: token() };

let child: ChildProcess;
let dataDir: string;
let origin: string;
let logs = '';

async function freePort() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as { port: number };
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

test.beforeAll(async () => {
  const port = await freePort();
  dataDir = await mkdtemp(join(tmpdir(), 'replays-distro-'));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/server.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DISTRO_SIGNING_SECRET: SECRET,
      POSTERS_DISABLED: '1',
      RENDER_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => (logs += chunk.toString()));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the distribution exited early:\n${logs}`);
    if (
      await fetch(`${origin}/healthz`).then(
        (response) => response.ok,
        () => false,
      )
    )
      break;
    if (Date.now() > deadline) throw new Error(`the distribution did not start:\n${logs}`);
    await new Promise((done) => setTimeout(done, 100));
  }
});

test.afterAll(async () => {
  child.kill('SIGTERM');
  await new Promise((done) => setTimeout(done, 300));
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
});

test.describe('auth adapter (signed identity header)', () => {
  test('the health check is public, everything else needs a valid signed identity', async ({ request }) => {
    expect((await request.get(`${origin}/healthz`)).status()).toBe(200);
    const api = `${origin}${BASE}/api/replays`;
    expect((await request.get(api)).status()).toBe(403);
    expect((await request.get(api, { headers: { [IDENTITY_HEADER]: 'garbage' } })).status()).toBe(403);
    expect((await request.get(api, { headers: { [IDENTITY_HEADER]: token('ada@acme.test', {}, 'wrong-secret') } })).status()).toBe(403);
    expect((await request.get(api, { headers: { [IDENTITY_HEADER]: token('ada@acme.test', { exp: 1 }) } })).status()).toBe(403);
    expect((await request.get(api, { headers: { [IDENTITY_HEADER]: token('ada@acme.test', { aud: 'other' }) } })).status()).toBe(403);
    expect((await request.get(api, { headers: { [IDENTITY_HEADER]: token('mallory@elsewhere.test') } })).status()).toBe(403);
    expect((await request.get(api, { headers: asAda })).status()).toBe(200);
  });

  test('the signed-in person is the identity', async ({ request }) => {
    const me = await (await request.get(`${origin}${BASE}/api/me`, { headers: asAda })).json();
    expect(me).toMatchObject({ id: 'ada@acme.test', email: 'ada@acme.test', name: 'Ada' });
    const config = await (await request.get(`${origin}${BASE}/api/config`, { headers: asAda })).json();
    expect(config).toMatchObject({ name: 'Acme Replays', auth: 'acme-iap', plugins: ['acme-distro'] });
    expect(config.sourceProviders).toContain('acme-chat');
  });
});

test.describe('branding and base path', () => {
  test.use({ extraHTTPHeaders: asAda });

  test('name, logo and theme tokens are applied under the base path', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('replays-theme', 'dark'));
    await page.goto(`${origin}${BASE}/`);
    await expect(page).toHaveTitle('Acme Replays');
    await expect(page.getByRole('heading', { level: 1, name: 'Acme Replays' })).toBeVisible();
    await expect(page.locator('meta[name="app-logo"]')).toHaveAttribute('content', /^data:image\/svg\+xml;base64,/);
    await expect(page.locator('header img, h1 img').first()).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(page.locator('style#brand-tokens')).toBeAttached();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()))
      .toBe('#ff6600');
    expect(new URL(page.url()).pathname).toBe(`${BASE}/`);
  });
});

test.describe('context adapter, source provider, hooks, custom tab, action and panel', () => {
  test.use({ extraHTTPHeaders: asAda });
  const id = `distro-${Date.now().toString(36)}`;

  test('an upload is stamped by the context adapter and its chat source resolves', async ({ request }) => {
    const original = await (await request.get(`${origin}${BASE}/api/replays/demo-shop`)).json();
    const bundle = {
      ...original,
      meta: { ...original.meta, id, title: 'Distro check' },
      context: { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', sources: [{ provider: 'acme-chat', ref: 'C123/p456' }] },
    };
    const response = await request.post(`${origin}${BASE}/api/replays`, { data: bundle });
    expect(response.status(), await response.text()).toBe(201);
    const stored = await (await request.get(`${origin}${BASE}/api/replays/${id}`)).json();
    expect(stored.context.fields).toEqual({ environment: 'staging', uploadedBy: 'ada@acme.test' });
    expect(stored.context.sources[0]).toMatchObject({ provider: 'acme-chat', url: 'https://chat.example.com/archives/C123/p456' });
  });

  test('the beforeUpload hook refuses, the request hook answers, the response and upload hooks ran', async ({ request }) => {
    const original = await (await request.get(`${origin}${BASE}/api/replays/demo-shop`)).json();
    const refused = await request.post(`${origin}${BASE}/api/replays`, {
      data: { ...original, meta: { ...original.meta, id: `${id}-no`, title: 'Nope [no-upload]' } },
    });
    expect(refused.status()).toBe(422);
    expect(await refused.text()).toContain('refuses [no-upload]');
    expect((await request.get(`${origin}${BASE}/api/replays/${id}-no`)).status()).toBe(404);

    const stats = await (await request.get(`${origin}${BASE}/_distro/stats`)).json();
    expect(stats.user).toBe('ada@acme.test');
    expect(stats.responses).toBeGreaterThan(3);
    expect(stats.uploads).toBeGreaterThanOrEqual(1);
    expect((await request.get(`${origin}${BASE}/_distro/stats`, { headers: { [IDENTITY_HEADER]: 'nope' } })).status()).toBe(403);
  });

  test('the Context tab renders the adapter’s fields with the schema’s titles', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await page.getByTestId('context-tab').click();
    const panel = page.getByTestId('context-fields');
    await expect(panel.locator('> dl > .ctx-row > dt')).toHaveText(['Environment', 'Uploaded by']);
    await expect(panel).toContainText('staging');
    await expect(panel).toContainText('ada@acme.test');
  });

  test('the custom inspector tab is visible and drawn by the browser entry', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    const tab = page.getByTestId(`plugin:acme-distro:build-tab`);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText('Acme build');
    await tab.click();
    const content = page.getByTestId('plugin:acme-distro:build-panel');
    await expect(content).toContainText('Distro check');
    await expect(content).toContainText('Environment');
    await expect(content).toContainText('staging');
  });

  test('the custom viewer action and panel are in the More menu', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('plugin-action:acme-distro:copy-summary').click();
    await expect(page.getByText('Acme summary copied')).toBeVisible();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('plugin-panel-open:acme-distro:notes').click();
    const panel = page.getByTestId('plugin:acme-distro:notes').or(page.getByTestId('plugin-panel:acme-distro:notes'));
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Notes for Distro check');
    await expect(page.getByTestId('acme-clock')).toBeAttached();
  });

  test('plugin files are served behind the auth', async ({ request }) => {
    const script = `${origin}${BASE}/_plugins/acme-distro/main.js`;
    expect((await request.get(script, { headers: { [IDENTITY_HEADER]: 'nope' } })).status()).toBe(403);
    const response = await request.get(script, { headers: asAda });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
  });
});
