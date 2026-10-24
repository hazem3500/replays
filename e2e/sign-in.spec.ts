import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serveApp } from './support.ts';

let dir: string;
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'replays-sign-in-e2e-'));
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ basePath: '/replays', beta: { editor: true }, signIn: { path: '/api/sign-in' } }),
  );
});
test.afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
const server = serveApp(() => ({ REPLAYS_CONFIG: join(dir, 'config.json') }));

for (const path of ['/', '/r/demo-shop', '/s/example-suite', '/r/demo-shop/edit']) {
  test(`public viewer recovers a proxy 401 on ${path}`, async ({ page }) => {
    let signedIn = false;
    let attempts = 0;
    await page.route('**/replays/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/replays/api/sign-in') {
        signedIn = true;
        attempts++;
        await route.continue();
      } else if (!signedIn) await route.fulfill({ status: 401, body: 'proxy sign-in required' });
      else await route.continue();
    });
    const target = `${server().origin}/replays${path}${path === '/' ? '?q=shop' : '?t=2#step-2'}`;
    await page.goto(target);
    await expect.poll(() => attempts).toBe(1);
    await expect(page).toHaveURL(target);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    expect(signedIn).toBe(true);
  });
}

test('a sign-in that does not stick stops automatically and offers a manual link', async ({ page }) => {
  let attempts = 0;
  await page.route('**/replays/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/replays/api/sign-in') {
      attempts++;
      await route.continue();
    } else await route.fulfill({ status: 401, body: 'proxy sign-in required' });
  });
  await page.goto(`${server().origin}/replays/r/demo-shop`);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect.poll(() => attempts).toBe(1);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  expect(attempts).toBe(1);
});

test('a proxy redirect is distinguished from offline, with storage-disabled manual recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('storage unavailable');
      },
    });
  });
  await page.route('https://sign-in.invalid/**', (route) => route.abort('failed'));
  await page.route('**/replays/api/**', (route) => route.fulfill({ status: 302, headers: { location: 'https://sign-in.invalid/login' } }));
  await page.goto(`${server().origin}/replays/r/demo-shop?t=2#step-2`);
  const signIn = page.getByRole('link', { name: 'Sign in', exact: true });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute('href', '/replays/api/sign-in?next=%2Freplays%2Fr%2Fdemo-shop%3Ft%3D2%23step-2');
  await expect(page).toHaveURL(/\/replays\/r\/demo-shop\?t=2#step-2$/);
});
