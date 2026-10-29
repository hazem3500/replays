import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
const AVATAR = 'https://img.example.com/ada.png';
const token = (email = 'ada@acme.test', overrides: Partial<Parameters<typeof signIdentity>[0]> = {}, secret = SECRET) =>
  signIdentity({ email, name: 'Ada', avatarUrl: AVATAR, aud: AUDIENCE, exp: exp(), ...overrides }, secret);
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
    expect(config).toMatchObject({ name: 'Acme Replays', auth: 'acme-iap', comments: true, plugins: ['comments', 'acme-distro'] });
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

  // Each worker (including a retry worker) owns and seeds its server data.
  test.beforeAll(async ({ request }) => {
    const original = await (await request.get(`${origin}${BASE}/api/replays/demo-shop`)).json();
    const bundle = {
      ...original,
      meta: { ...original.meta, id, title: 'Distro check' },
      context: { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', sources: [{ provider: 'acme-chat', ref: 'C123/p456' }] },
    };
    const response = await request.post(`${origin}${BASE}/api/replays`, { data: bundle });
    expect(response.status(), await response.text()).toBe(201);
  });

  test('an upload is stamped by the context adapter and its chat source resolves', async ({ request }) => {
    const stored = await (await request.get(`${origin}${BASE}/api/replays/${id}`)).json();
    expect(stored.context.fields).toEqual({ environment: 'staging', uploadedBy: 'ada@acme.test' });
    expect(stored.context.sources[0]).toMatchObject({
      provider: 'acme-chat',
      url: 'https://chat.example.com/archives/C123/p456',
      attrs: { channel: 'C123' },
    });
    // The attribute is in the index summary too.
    const list = await (await request.get(`${origin}${BASE}/api/replays`)).json();
    const summary = (list.replays ?? list).find((entry: { id: string }) => entry.id === id);
    expect(summary.sources[0]).toMatchObject({ provider: 'acme-chat', attrs: { channel: 'C123' } });
  });

  test('the chat provider’s icon is drawn as an image on the topbar chip, in the Context tab and on the index row', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    const chip = page.getByTestId('source-chip');
    await expect(chip).toHaveAttribute('aria-label', /Acme Chat thread/);
    await expect(chip.locator('img[data-provider-icon="acme-chat"]')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await page.getByTestId('context-tab').click();
    const row = page.locator('.ctx-source').first();
    await expect(row.locator('img[data-provider-icon="acme-chat"]')).toBeVisible();
    await expect(row).toContainText('Acme Chat thread · C123');
    // Never inlined: no plugin SVG markup in the page.
    expect(await page.locator('svg path[fill="#ff6600"]').count()).toBe(0);

    await page.goto(`${origin}${BASE}/`);
    await expect(page.locator('.source-link img[data-provider-icon="acme-chat"]').first()).toBeVisible();
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

  test('a bar action is a header button, not a More item', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}?t=3`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    const button = page.locator('header').getByTestId('plugin-action:acme-distro:jump-start');
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName('Back to the start (Acme)');
    await expect(button.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await button.click();
    await expect(page.getByText('Back at 0:00')).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /^0:00\.0 of /);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menu').getByTestId('plugin-action:acme-distro:jump-start')).toHaveCount(0);
  });

  test('the timeline track marks the console problems under the seek bar; a click seeks there', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    const markers = page.getByTestId('plugin-track:acme-distro:console-problems').getByTestId('plugin-track-marker');
    // demo-shop logs one warning and one error at the same moment.
    await expect(markers).toHaveCount(2);
    await expect(markers.first()).toHaveAccessibleName(/^Console problems: .+, at 0:07\.\d$/);
    // The two share a moment, so the later-drawn one is on top.
    await markers.last().click();
    await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /^0:07\.\d of /);
  });

  test('a plugin exports JSON through the Download menu without MP4 rendering', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await page.getByRole('button', { name: 'Download replay', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Console JSON', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`${id}-console.json`);
    const path = await download.path();
    if (!path) throw new Error('download missing');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expect.any(Array));
  });

  test('a host shortcut runs while the viewer owns the keyboard', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await page.keyboard.press('g');
    await expect(page.getByText('Acme shortcut ran')).toBeVisible();
  });

  test('a host editor tool saves through the normal edits API', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}/edit`);
    await page.getByRole('button', { name: 'Mark for Acme', exact: true }).click();
    await expect(page.getByTestId('region-caption')).toHaveCount(1);
    await expect
      .poll(async () => {
        const response = await page.request.get(`${origin}${BASE}/api/replays/${id}/edits`);
        return response.text();
      })
      .toContain('Review this moment');
  });

  test('the Context section draws inside the Context tab and follows a boolean setting from the More menu', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await page.getByTestId('context-tab').click();
    const section = page.getByTestId('plugin:acme-distro:release-section');
    await expect(section).toContainText('Acme release');
    await expect(section.getByTestId('acme-release')).toHaveText(/^Released to staging, recorded /);

    await page.getByRole('button', { name: 'More actions' }).click();
    const compact = page.getByTestId('plugin-setting:acme-distro:compact');
    await expect(compact).toHaveAttribute('aria-checked', 'false');
    await compact.click();
    await expect(compact).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(section.getByTestId('acme-release')).toHaveText('staging');
    expect(await page.evaluate(() => localStorage.getItem('replays-plugin:acme-distro:setting:compact'))).toBe('true');

    // Stored per person in this browser: still on after a reload.
    await page.reload();
    await page.getByTestId('context-tab').click();
    await expect(page.getByTestId('plugin:acme-distro:release-section').getByTestId('acme-release')).toHaveText('staging');
  });

  test('a choice setting changes what the plugin panel draws', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}?t=2`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('plugin-panel-open:acme-distro:notes').click();
    await expect(page.getByTestId('acme-clock')).toHaveText('2 s');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('plugin-setting:acme-distro:units:ms').click();
    await expect(page.getByTestId('plugin-setting:acme-distro:units:ms')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('acme-clock')).toHaveText('2000 ms');
  });

  test('plugin files are served behind the auth', async ({ request }) => {
    const script = `${origin}${BASE}/_plugins/acme-distro/main.js`;
    expect((await request.get(script, { headers: { [IDENTITY_HEADER]: 'nope' } })).status()).toBe(403);
    const response = await request.get(script, { headers: asAda });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
  });
});

test.describe('comments work through the plugin surface with the distribution’s identity', () => {
  test.use({ extraHTTPHeaders: asAda });
  const id = `distro-comments-${Date.now().toString(36)}`;

  test('the comments plugin is loaded and its API answers behind the signed-header auth', async ({ request }) => {
    const original = await (await request.get(`${origin}${BASE}/api/replays/demo-shop`)).json();
    const created = await request.post(`${origin}${BASE}/api/replays`, {
      data: { ...original, meta: { ...original.meta, id, title: 'Comments check' } },
    });
    expect(created.status()).toBe(201);
    const url = `${origin}${BASE}/api/replays/${id}/comments`;
    expect((await request.get(url, { headers: { [IDENTITY_HEADER]: 'nope' } })).status()).toBe(403);
    const posted = await request.post(url, { data: { body: 'Posted through the API', at: 2000 } });
    expect(posted.status()).toBe(201);
    // The author is the plugin identity: name and avatar come from the signed header, the id stays private.
    const listed = await (await request.get(url)).json();
    expect(listed.anonymous).toBe(false);
    expect(listed.comments[0]).toMatchObject({
      body: 'Posted through the API',
      at: 2000,
      mine: true,
      author: { name: 'Ada', avatarUrl: AVATAR },
    });
    expect(JSON.stringify(listed)).not.toContain('ada@acme.test');
  });

  test('the Comments tab, written with the keyboard, names Ada from the signed header and marks the seek bar', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}?t=3`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    // The comment from the previous test is a marker on the seek bar and counted on the tab.
    await expect(page.getByTestId('comment-marker')).toHaveCount(1);
    await expect(page.getByTestId('comments-tab')).toContainText('1');
    await page.keyboard.press('m');
    await expect(page.getByTestId('comments-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('comment-input')).toBeFocused();
    await page.keyboard.type('Written in the browser');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('comment-thread')).toHaveCount(2);
    await expect(page.getByTestId('comment-author').first()).toHaveText('Ada');
    await expect(page.getByTestId('comments-tab')).toContainText('2');
  });

  test('the custom tab, the Comments tab and the built-in tabs live side by side', async ({ page }) => {
    await page.goto(`${origin}${BASE}/r/${id}`);
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    for (const tab of ['console-tab', 'context-tab', 'comments-tab', 'plugin:acme-distro:build-tab'])
      await expect(page.getByTestId(tab)).toBeVisible();
  });
});

test.describe('index slots: summary fields, a server filter, and a column, filter and section in the list', () => {
  test.use({ extraHTTPHeaders: asAda });
  const run = Date.now().toString(36);
  const staging = `distro-staging-${run}`;
  const production = `distro-production-${run}`;

  test('summary fields are derived at upload and the plugin filter narrows GET /api/replays', async ({ request }) => {
    const original = await (await request.get(`${origin}${BASE}/api/replays/demo-shop`)).json();
    for (const [id, environment] of [
      [staging, 'staging'],
      [production, 'production'],
    ] as const) {
      const response = await request.post(`${origin}${BASE}/api/replays`, {
        data: { ...original, meta: { ...original.meta, id, title: `Index ${environment}`, capturedAt: new Date().toISOString() } },
        headers: { 'x-acme-environment': environment },
      });
      expect(response.status(), await response.text()).toBe(201);
    }
    const all = (await (await request.get(`${origin}${BASE}/api/replays`)).json()) as Array<{ id: string; ext?: unknown }>;
    expect(all.find((summary) => summary.id === production)?.ext).toEqual({
      'acme-distro': { environment: 'production', uploadedBy: 'ada@acme.test' },
    });
    const filtered = (await (await request.get(`${origin}${BASE}/api/replays?x-env=production`)).json()) as Array<{ id: string }>;
    expect(filtered.map((summary) => summary.id)).toContain(production);
    expect(filtered.map((summary) => summary.id)).not.toContain(staging);
    const config = await (await request.get(`${origin}${BASE}/api/config`)).json();
    expect(config.indexFilters).toEqual([{ plugin: 'acme-distro', id: 'environment', param: 'x-env' }]);
  });

  test('the column, the section and the filter menu control are drawn by the browser entry', async ({ page }) => {
    await page.goto(`${origin}${BASE}/`);
    const row = (id: string) => page.locator(`.feed-list [data-entry-id="session:${id}"]`);
    await expect(row(production).getByTestId('plugin-column:acme-distro:environment')).toHaveText('env production');
    await expect(row(staging).getByTestId('plugin-column:acme-distro:environment')).toHaveText('env staging');
    const section = page.getByTestId('plugin-section:acme-distro:mine');
    await expect(section).toContainText('Uploaded by you');
    await expect(section).toContainText(/\d+ of \d+ listed replays are yours/);

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByTestId('plugin-filter:acme-distro:environment').click();
    await page.getByRole('option', { name: 'Production', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('x-env')).toBe('production');
    await page.keyboard.press('Escape');
    await expect(row(production)).toBeVisible();
    await expect(row(staging)).toHaveCount(0);
    // The section is drawn again for the filtered list, and knows who is signed in.
    await expect(section).toContainText('1 of 1 listed replays are yours');
  });
});
