import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, uniqueId, serveApp, useTheme } from './support.ts';

// Deployment settings the server applies at runtime: product name, a base path, theme tokens and a JSON Schema
// for the context fields. Each describe block runs its own server.

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-config-'));
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ theme: { dark: { accent: '#ff6600' }, light: { accent: '#0066ff' } } }));
  await writeFile(
    join(configDir, 'context.schema.json'),
    JSON.stringify({
      type: 'object',
      properties: {
        ticket_url: { type: 'string', format: 'uri', title: 'Ticket', description: 'Where the work is tracked' },
        release_channel: { type: 'string', enum: ['stable', 'beta'], title: 'Release channel' },
        is_internal: { type: 'boolean', title: 'Internal build' },
        labels: { type: 'array', items: { type: 'string' }, title: 'Labels' },
        owner: { type: 'object', title: 'Owner', properties: { team_name: { type: 'string', title: 'Team' } } },
      },
    }),
  );
});
test.afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

test.describe('branding under /replays', () => {
  const server = serveApp(() => ({
    PRODUCT_NAME: 'Acme Replays',
    BASE_PATH: '/replays',
    REPLAYS_CONFIG: join(configDir, 'config.json'),
  }));
  const origin = () => server().origin;

  test('the index shows the configured name and works under the base path', async ({ page }) => {
    await page.goto(`${origin()}/replays/`);
    await expect(page).toHaveTitle('Acme Replays');
    await expect(page.getByRole('heading', { level: 1, name: 'Acme Replays' })).toBeVisible();
    await expect(page.locator('meta[name="app-name"]')).toHaveAttribute('content', 'Acme Replays');
    await expect(page.getByRole('status').first()).toHaveText('2 replays');
    await expect(page.getByRole('link', { name: /^Demo shop/ })).toHaveAttribute('href', '/replays/r/demo-shop');
    await page.getByRole('link', { name: /^Demo shop/ }).click();
    await expect(page).toHaveURL(`${origin()}/replays/r/demo-shop`);
    await expect(page.getByRole('heading', { level: 1, name: 'Demo shop: checkout with a bad coupon' })).toBeVisible();
  });

  test('a replay opens under the base path and its data comes from the prefixed API', async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/api/')) apiRequests.push(url.pathname);
    });
    await openReplay(page, `${origin()}/replays/r/demo-shop`);
    await expect(page).toHaveTitle('Demo shop: checkout with a bad coupon · Acme Replays');
    await expect(page.getByTestId('step-timeline').locator('[data-step-index]')).toHaveCount(18);
    await expect(page.frameLocator('.player-host iframe').getByText('Pinecone Goods').first()).toBeVisible();
    await page.getByRole('link', { name: 'All replays' }).click();
    await expect(page).toHaveURL(`${origin()}/replays/`);
    expect(apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests.every((path) => path.startsWith('/replays/api/'))).toBe(true);
  });

  test('the API answers under the prefix with the configured name', async ({ request }) => {
    const replays = await request.get(`${origin()}/replays/api/replays`);
    expect(replays.status()).toBe(200);
    expect((await replays.json()).map((entry: { id: string }) => entry.id).sort()).toEqual(['demo-shop', 'human-demo']);
    const config = await (await request.get(`${origin()}/replays/api/config`)).json();
    expect(config).toMatchObject({ name: 'Acme Replays', auth: 'none' });
  });

  test('theme tokens are served as brand-tokens and apply per colour scheme', async ({ page }) => {
    await useTheme(page, 'dark');
    await page.goto(`${origin()}/replays/`);
    await expect(page.locator('style#brand-tokens')).toBeAttached();
    const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase());
    await expect.poll(accent).toBe('#ff6600');

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(accent).toBe('#0066ff');
  });
});

test.describe('context fields through a configured JSON Schema', () => {
  const server = serveApp(() => ({ CONTEXT_SCHEMA_FILE: join(configDir, 'context.schema.json') }));
  const origin = () => server().origin;

  const fields = {
    is_internal: true,
    extra_key: 'not in the schema',
    release_channel: 'beta',
    labels: ['alpha', 'beta'],
    owner: { team_name: 'Core' },
    ticket_url: 'https://example.com/tickets/7',
  };

  test('titles, links, Yes/No, chips and nesting follow the schema', async ({ page }) => {
    const id = uniqueId('schema');
    const bundle = await cloneBundle(page.request, origin(), 'demo-shop', id, 'Schema fixture');
    bundle.context = { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', fields };
    await postBundle(page.request, origin(), bundle);

    await openReplay(page, `${origin()}/r/${id}`);
    await page.getByTestId('context-tab').click();
    const panel = page.getByTestId('context-fields');
    const labels = panel.locator('> dl > .ctx-row > dt');
    // Schema order first (ticket, channel, internal, labels, owner), then keys the schema does not describe.
    await expect(labels).toHaveText(['Ticket', 'Release channel', 'Internal build', 'Labels', 'Owner', 'Extra key']);
    const link = panel.getByRole('link', { name: /^https:\/\/example\.com\/tickets\/7/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/tickets/7');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(panel.locator('.ctx-bool')).toHaveText('Yes');
    await expect(panel.locator('.ctx-chip')).toHaveText(['alpha', 'beta']);
    await expect(panel.locator('.ctx-rows[data-nested]')).toContainText('Team');
    await expect(panel.locator('.ctx-rows[data-nested]')).toContainText('Core');
    // The description is the help text of the label.
    await panel.getByText('Ticket', { exact: true }).hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Where the work is tracked');
  });

  test('the server rejects fields that break the schema', async ({ request }) => {
    const bundle = await cloneBundle(request, origin(), 'demo-shop', uniqueId('bad-fields'));
    bundle.context = { version: 1, capturedAt: '2026-10-10T12:00:00.000Z', fields: { is_internal: 'yes please' } };
    const response = await request.post(`${origin()}/api/replays`, { data: bundle });
    expect(response.status()).toBe(400);
  });

  test('the client config carries the schema', async ({ request }) => {
    const config = await (await request.get(`${origin()}/api/config`)).json();
    expect(config.contextSchema.properties.ticket_url).toMatchObject({ format: 'uri', title: 'Ticket' });
  });
});
