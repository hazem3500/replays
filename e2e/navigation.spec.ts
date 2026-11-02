import { expect, test } from '@playwright/test';

import { origin, gotoHydrated, serveApp } from './support.ts';

test.describe('server-rendered index', () => {
  const server = serveApp({ REPLAYS_SSR: '1' });
  test('the list is visible when JavaScript is disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto(server().origin);
      await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('the library hydrates in a different locale and time zone before showing local dates', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Pacific/Auckland' });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await gotoHydrated(page, server().origin);
      if (!response) throw new Error('The server-rendered library must return an HTML response');
      const times = await page.evaluate(
        (html) => {
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const row = parsed.querySelector('a.row-target[href="/r/demo-shop"]')?.closest('li');
          const time = row?.querySelector('time');
          if (!time?.dateTime) throw new Error('The server must render the sample recording date');
          const date = new Date(time.dateTime);
          const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
          if (date.getUTCFullYear() !== new Date().getUTCFullYear()) options.year = 'numeric';
          return {
            rendered: time.textContent,
            utc: new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(date).replace(/[\u00a0\u202f]/g, ' '),
            local: new Intl.DateTimeFormat(undefined, options).format(date).replace(/[\u00a0\u202f]/g, ' '),
          };
        },
        await response.text(),
      );
      expect(times.rendered).toBe(times.utc);
      expect(times.local).not.toBe(times.utc);
      const time = page.locator('a.row-target[href="/r/demo-shop"]').locator('xpath=ancestor::li').locator('time').first();
      await expect(time).toHaveText(times.local);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test('a direct replay visit loads the index interface only when returning home', async ({ page }) => {
  const indexRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/ReplayIndex-[^/]+\.js/.test(request.url())) indexRequests.push(request.url());
  });
  await gotoHydrated(page, `${origin()}/r/demo-shop`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  expect(indexRequests).toEqual([]);
  await page.getByRole('link', { name: 'All replays', exact: true }).click();
  await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
  expect(indexRequests).toHaveLength(1);
});

test('the library header keeps search and actions in one compact row', async ({ page }) => {
  await page.setViewportSize({ width: 1026, height: 800 });
  await gotoHydrated(page, origin());
  const header = page.locator('.index-head > .topbar');
  await expect(header).toHaveCSS('display', 'flex');
  const box = await header.boundingBox();
  expect(box?.height).toBeLessThan(70);
  const search = header.getByRole('combobox');
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('the index downloads the player only after row intent', async ({ page }) => {
  const playerRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/(?:Viewer|player)-[^/]+\.js/.test(request.url())) playerRequests.push(request.url());
  });
  await gotoHydrated(page, origin());
  await page.waitForTimeout(4500);
  expect(playerRequests).toEqual([]);
  await page.locator('a.row-target[href="/r/demo-shop"]').first().hover();
  await expect.poll(() => playerRequests.length).toBeGreaterThan(0);
});

test('a thumbnail morphs into the loading frame and returns to the same card on Back', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/replays/demo-shop', async (route) => {
    await gate;
    await route.continue();
  });
  await page.route('**/api/replays/demo-shop/poster?*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/></svg>',
    }),
  );
  await gotoHydrated(page, origin());
  const link = page.locator('a.row-target[href="/r/demo-shop"]').first();
  await link.hover();
  const poster = link.locator('xpath=ancestor::li').locator('.poster > img').first();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const snapshots: Array<{ hero: string | undefined; before: string[]; after: string[] }> = [];
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: page.evaluate serializes this browser boundary without module-level helpers.
    const named = (root: Document) =>
      [...root.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]
        .filter((element) => element.style.viewTransitionName === 'vt-page-hero')
        .map((element) => element.tagName);
    Object.assign(window, { navigationSnapshots: snapshots });
    document.startViewTransition = (update) => {
      const before = named(document);
      return start(async () => {
        if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
        await update();
        snapshots.push({
          hero: document.documentElement.dataset.pageHero,
          before,
          after: named(document),
        });
      });
    };
  });
  await link.click();
  await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
  await expect(page.locator('main.skeleton-shell')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'navigationSnapshots')))
    .toEqual([{ hero: 'to-viewer', before: ['IMG'], after: ['DIV'] }]);
  await expect(page.locator('.skeleton-overlay')).toHaveCount(0);
  release();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.locator('main.skeleton-shell, .skeleton-overlay')).toHaveCount(0);
  await page.goBack();
  await expect(link).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'navigationSnapshots')))
    .toEqual([
      { hero: 'to-viewer', before: ['IMG'], after: ['DIV'] },
      { hero: 'to-index', before: ['DIV'], after: ['IMG'] },
    ]);
});

test('reduced motion opens replay without starting a page transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, origin());
  await page.evaluate(() => {
    document.startViewTransition = () => {
      throw new Error('Reduced motion must not start a view transition');
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  expect(errors).toEqual([]);
});

test('settings opens a dialog of sections without its own theme buttons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoHydrated(page, origin());
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'CLI & agents' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: /^(Light|Dark)$/ })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await expect(dialog.getByRole('tabpanel')).toContainText('Play or pause');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
