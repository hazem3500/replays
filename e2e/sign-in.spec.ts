import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cloneBundle, createSuite, postBundle, serveApp, uniqueId } from './support.ts';

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
  // why: the automatic attempt navigates away and back; reload once the page it returns to has loaded.
  await page.waitForURL(`${server().origin}/replays/r/demo-shop`, { waitUntil: 'load' });
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
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

/** Keep TanStack's cache alive while changing the observed page. */
async function inPage(page: Page, path: string) {
  await page.evaluate((next) => {
    history.pushState(null, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

for (const kind of ['replay', 'suite'] as const) {
  test(`cached ${kind} waits for sign-in when only fresh edits are refused`, async ({ page }) => {
    const base = `${server().origin}/replays`;
    const id = uniqueId(`auth-cached-${kind}`);
    const suite = uniqueId('auth-suite');
    if (kind === 'suite') {
      await createSuite(page.request, base, suite, [{ id: 'run-1', label: 'Cached run', status: 'passed', replayId: id }]);
    } else {
      await postBundle(page.request, base, await cloneBundle(page.request, base, 'demo-shop', id, 'Cached recording'));
    }
    const editsUrl = `${base}/api/replays/${id}/edits`;
    const original = await page.request.get(editsUrl);
    expect(
      (
        await page.request.put(editsUrl, {
          headers: { 'if-match': original.headers().etag! },
          data: { version: 1, cuts: [{ id: 'cut-1', from: 1000, to: 2000 }] },
        })
      ).ok(),
    ).toBe(true);
    let bundleReads = 0;
    await page.route(
      (url) => url.pathname === `/replays/api/replays/${id}`,
      async (route) => {
        bundleReads++;
        await route.continue();
      },
    );
    const path = kind === 'suite' ? `/replays/s/${suite}/r/${id}` : `/replays/r/${id}`;
    await page.goto(`${server().origin}${path}`);
    await expect(page.getByTestId('edited-chip')).toBeVisible();
    const cachedReads = bundleReads;
    await inPage(page, '/replays/');
    await expect(page.locator('.index-shell')).toBeVisible();
    await page.clock.setFixedTime(new Date(Date.now() + 20_000));
    await page.evaluate(() => sessionStorage.setItem('replays:sign-in-attempt', String(Date.now())));
    await page.route(editsUrl, (route) => route.fulfill({ status: 401, body: 'session expired' }));
    await inPage(page, path);
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByTestId('replay-player')).toHaveCount(0);
    expect(bundleReads).toBe(cachedReads);
  });
}

test('a cached suite surfaces an observed background auth failure', async ({ page }) => {
  const base = `${server().origin}/replays`;
  const suite = uniqueId('auth-background-suite');
  const id = uniqueId('auth-background-run');
  await createSuite(page.request, base, suite, [{ id: 'run-1', label: 'Cached suite run', status: 'passed', replayId: id }]);
  await page.goto(`${base}/s/${suite}/r/${id}`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await page.clock.setFixedTime(new Date(Date.now() + 60_000));
  await page.evaluate(() => sessionStorage.setItem('replays:sign-in-attempt', String(Date.now())));
  let refreshes = 0;
  await page.route(
    (url) => url.pathname === `/replays/api/suites/${suite}`,
    async (route) => {
      refreshes++;
      await route.fulfill({ status: 401, body: 'session expired' });
    },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByTestId('replay-player')).toHaveCount(0);
});

test('ordinary edits failures retain the recorded fallback without sign-in recovery', async ({ page }) => {
  await page.route('**/replays/api/replays/demo-shop/edits', (route) => route.fulfill({ status: 500, body: 'unavailable' }));
  await page.goto(`${server().origin}/replays/r/demo-shop`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
});
