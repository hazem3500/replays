import { expect, test } from '@playwright/test';

import { origin, gotoHydrated } from './support.ts';

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

test('opening a replay uses one page crossfade and one loading layout', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/replays/demo-shop', async (route) => {
    await gate;
    await route.continue();
  });
  await gotoHydrated(page, origin());
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const snapshots: Array<{ direction: string | undefined; layers: string[] }> = [];
    Object.assign(window, { navigationSnapshots: snapshots });
    document.startViewTransition = (update) =>
      start(async () => {
        if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
        await update();
        snapshots.push({
          direction: document.documentElement.dataset.pageTransition,
          layers: [...document.querySelectorAll('.app-shell, .app-shell *')]
            .map((element) => getComputedStyle(element).viewTransitionName)
            .filter((name) => name !== 'none'),
        });
      });
  });
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
  await expect(page.locator('main.skeleton-shell')).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'navigationSnapshots'))).toEqual([{ direction: 'page', layers: [] }]);
  await expect(page.locator('.skeleton-overlay')).toHaveCount(0);
  release();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.locator('main.skeleton-shell, .skeleton-overlay')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
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
