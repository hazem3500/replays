import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type APIRequestContext, type Browser, expect, test } from '@playwright/test';

import { serveApp, uniqueId } from './support.ts';

// People on recordings (meta.people) with a host plugin's api.people: the avatar stack on index rows and its card, and
// the "For me" filter with a linked GitHub handle.

let configDir: string;
test.beforeAll(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'replays-e2e-people-'));
  await writeFile(join(configDir, 'config.json'), JSON.stringify({ plugins: [resolve(import.meta.dirname, 'people-plugin.mjs')] }));
});
test.afterAll(async () => {
  await rm(configDir, { recursive: true, force: true });
});

const server = serveApp(() => ({
  AUTH_MODE: 'plugin',
  AUTH_PLUGIN: resolve(import.meta.dirname, 'comments-auth.mjs'),
  REPLAYS_CONFIG: join(configDir, 'config.json'),
}));
const base = () => server().origin;

const ADA = { 'x-e2e-user': 'ada@example.com' };
// A 1×1 PNG: avatars are served by the test, never fetched from the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function upload(request: APIRequestContext, title: string, people: unknown[]) {
  const id = uniqueId('people');
  const bundle = await (await request.get(`${base()}/api/replays/demo-shop`, { headers: ADA })).json();
  bundle.meta = { ...bundle.meta, id, title, people };
  const response = await request.post(`${base()}/api/replays`, { data: bundle, headers: ADA });
  expect(response.status(), await response.text()).toBe(201);
  return id;
}

async function asAda(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: ADA });
  await context.route('https://avatars.example.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  return { context, page: await context.newPage() };
}

test('index rows show their people as an avatar stack; the card names them, their role, email and profile', async ({
  browser,
  request,
}) => {
  const id = await upload(request, 'People stack check', [
    { role: 'reviewer', email: 'ada@example.com', name: 'Ada Lovelace', handles: { github: 'ada' } },
    { role: 'requester', email: 'bob@example.com' },
  ]);
  const { context, page } = await asAda(browser);
  await page.goto(`${base()}/`);
  const row = page.locator(`[data-entry-id="session:${id}"]`);
  const stack = row.getByTestId('people-stack');
  await expect(stack).toHaveAccessibleName('People: Ada Lovelace (you), reviewer; bob, requester');
  await expect(stack.locator('.person-avatar')).toHaveCount(2);
  await expect(stack.locator('img')).toHaveAttribute('src', 'https://avatars.example.test/ada.png');
  // Rows without people have no stack.
  await expect(page.locator('[data-entry-id="session:demo-shop"]').getByTestId('people-stack')).toHaveCount(0);

  await stack.click();
  const card = page.locator('.person-card');
  await expect(card).toBeVisible();
  const details = card.getByTestId('person-details');
  await expect(details).toHaveCount(2);
  await expect(details.first()).toContainText('Ada Lovelace');
  await expect(details.first()).toContainText('That’s you');
  await expect(details.first()).toContainText('Reviewer');
  await expect(details.first().getByRole('button', { name: 'Copy ada@example.com' })).toBeVisible();
  await expect(details.first().getByRole('link', { name: /Profile/ })).toHaveAttribute('href', 'https://profiles.example.test/ada');
  await expect(details.nth(1)).toContainText('Requester');
  await expect(details.nth(1).getByRole('link')).toHaveCount(0);
  await context.close();
});

test('For me keeps the rows I am on (by email, then by a linked GitHub handle) and stays in the URL', async ({ browser, request }) => {
  const mine = await upload(request, 'For me: by email', [{ role: 'mentioned', email: 'ada@example.com' }]);
  const byHandle = await upload(request, 'For me: by handle', [{ role: 'reviewer', handles: { github: 'ada-l' } }]);
  const other = await upload(request, 'For me: someone else', [{ role: 'reviewer', email: 'bob@example.com' }]);
  const { context, page } = await asAda(browser);
  await page.goto(`${base()}/`);
  const row = (id: string) => page.locator(`[data-entry-id="session:${id}"]`);
  await expect(row(other)).toBeVisible();

  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('switch', { name: 'For me' }).click();
  await expect(page).toHaveURL(/[?&]for=me/);
  await expect(row(mine)).toBeVisible();
  await expect(row(byHandle)).toHaveCount(0);
  await expect(row(other)).toHaveCount(0);
  await expect(page.locator('[data-entry-id="session:demo-shop"]')).toHaveCount(0);

  // Link a GitHub username: an invalid one is marked and not saved; a valid one is kept in this browser.
  const field = page.getByTestId('for-me-handle-github');
  await field.fill('not valid!');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.fill('Ada-L');
  await field.press('Enter');
  await expect(row(byHandle)).toBeVisible();
  await expect(row(mine)).toBeVisible();
  await expect(row(other)).toHaveCount(0);
  expect(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith('-linked-handles'))?.[1])).toBe(
    JSON.stringify({ github: 'Ada-L' }),
  );

  // A reload keeps both: For me from the URL, the handle from storage.
  await page.reload();
  await expect(row(byHandle)).toBeVisible();
  await expect(row(other)).toHaveCount(0);
  await context.close();
});
