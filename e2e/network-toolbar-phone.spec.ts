import { expect, test, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId, useTheme } from './support.ts';

const server = serveApp();

const SIZES = [
  [320, 720, 'light', 'reduce'],
  [390, 844, 'dark', 'no-preference'],
  [1280, 800, 'light', 'no-preference'],
] as const;

test('the Network toolbar is one row that fits, filters by status and searches, from 320 px to desktop', async ({ page }) => {
  const id = uniqueId('network-toolbar');
  await seedNetworkFixture(page, id);
  for (const [width, height, colorScheme, reducedMotion] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme, reducedMotion });
    await useTheme(page, colorScheme);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('network-tab').click();

    const toolbar = page.locator('.np-toolbar');
    await expect(toolbar).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width <= 600) {
      const heights = await toolbar
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
      expect(heights.every((targetHeight) => targetHeight >= 36)).toBe(true);
    }

    const rows = page.locator('[data-request-id]');
    await expect(rows).toHaveCount(2);
    await page.getByTestId('network-status-failed').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('/api/checkout');
    await expect(toolbar).toContainText('1 request');
    await page.getByTestId('network-status-failed').click();
    await expect(rows).toHaveCount(2);

    await checkSearch(page);
  }
});

async function checkSearch(page: Page) {
  const rows = page.locator('[data-request-id]');
  await page.getByTestId('network-search-toggle').click();
  const search = page.getByRole('searchbox', { name: 'Search requests' });
  await expect(search).toBeFocused();
  await search.fill('checkout');
  await expect(rows).toHaveCount(1);
  await search.fill('not-a-request');
  await expect(page.getByText('No matching requests')).toBeVisible();
  await search.fill('post 503');
  await expect(rows).toHaveCount(1);
  await search.press('Escape');
  await expect(page.getByTestId('network-search-toggle')).toBeFocused();
  await expect(rows).toHaveCount(2);
}

test('a selected request opens beside the list on desktop and in its place on a phone', async ({ page }) => {
  const id = uniqueId('network-detail');
  await seedNetworkFixture(page, id);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('network-tab').click();
  const checkout = page.getByRole('button', { name: /POST \/api\/checkout/ });
  await checkout.click();
  const detail = page.getByTestId('request-detail');
  await expect(detail).toContainText('503');
  await expect(detail).toContainText('Unavailable');
  await expect(page.getByTestId('network-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(checkout).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('network-tab').click();
  await checkout.click();
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('network-list')).toBeHidden();
  await detail.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.getByTestId('network-list')).toBeVisible();
  await expect(checkout).toBeFocused();
});

test('arrow keys move through requests and carry the open detail along', async ({ page }) => {
  const id = uniqueId('network-keys');
  await seedNetworkFixture(page, id);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('network-tab').click();
  const first = page.getByRole('button', { name: /GET \/api\/projects/ });
  await first.click();
  await expect(page.getByTestId('request-detail')).toContainText('/api/projects');
  await first.press('ArrowDown');
  await expect(page.getByRole('button', { name: /POST \/api\/checkout/ })).toBeFocused();
  await expect(page.getByTestId('request-detail')).toContainText('/api/checkout');
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
});

test('a busy recording gets the ribbon, and a drag across it narrows the list to that stretch', async ({ page }) => {
  const id = uniqueId('network-ribbon');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Busy network fixture');
  bundle.network = Array.from({ length: 40 }, (_, index) => ({
    id: `poll-${index}`,
    at: index * 200,
    duration: 20,
    method: 'GET',
    url: `https://shop.test/api/poll?n=${index}`,
    status: index === 20 ? 500 : 200,
    statusText: index === 20 ? 'Server Error' : 'OK',
    requestHeaders: [],
    responseHeaders: [],
  }));
  await postBundle(page.request, server().origin, bundle);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('network-tab').click();
  const ribbon = page.getByTestId('network-ribbon');
  await expect(ribbon).toBeVisible();
  await expect(ribbon.locator('.ribbon-mark[data-tone="danger"]')).toHaveCount(1);
  const box = (await ribbon.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const range = page.getByRole('button', { name: /^Show all times/ });
  await expect(range).toBeVisible();
  const shown = await page.locator('[data-request-id]').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(40);
  await range.click();
  await expect(range).toBeHidden();
});

async function seedNetworkFixture(page: Page, id: string) {
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Network toolbar fixture');
  bundle.network = [
    {
      id: 'projects',
      at: 1000,
      duration: 248,
      method: 'GET',
      url: 'https://shop.test/api/projects',
      status: 200,
      statusText: 'OK',
      requestHeaders: [],
      responseHeaders: [],
    },
    {
      id: 'checkout',
      at: 3400,
      duration: 812,
      method: 'POST',
      url: 'https://shop.test/api/checkout',
      status: 503,
      statusText: 'Unavailable',
      requestHeaders: [],
      responseHeaders: [],
    },
  ];
  await postBundle(page.request, server().origin, bundle);
}
