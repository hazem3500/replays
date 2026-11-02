import { expect, test, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId, useTheme } from './support.ts';

const server = serveApp();

test('the rendered Network toolbar stays usable at phone widths across themes and reduced motion', async ({ page }) => {
  const id = uniqueId('network-toolbar-phone');
  await seedNetworkFixture(page, id);

  for (const [width, height, colorScheme, reducedMotion] of [
    [320, 720, 'light', 'reduce'],
    [390, 844, 'dark', 'no-preference'],
    [1280, 800, 'light', 'no-preference'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme, reducedMotion });
    await useTheme(page, colorScheme);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('network-tab').click();

    const toolbar = page.locator('.net-toolbar');
    await expect(toolbar).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const phone = width <= 600;
    if (phone) {
      const targets = await toolbar
        .locator('button:visible, select:visible, .net-search')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(targets.every((targetHeight) => targetHeight >= 44)).toBe(true);
    }

    await checkSearch(page);
    await toolbar.getByRole('button', { name: 'Failed' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('/api/checkout');
    await toolbar.getByRole('button', { name: 'All', exact: true }).first().click();
    await expect(rows(page)).toHaveCount(2);

    const timing = page.getByRole('button', { name: 'Show the Timing column' });
    if (phone) await expect(timing).toHaveCount(0);
    else {
      await expect(page.locator('.net-ruler')).toHaveCount(1);
      await timing.click();
      await expect(page.locator('.net-ruler')).toHaveCount(0);
      await timing.click();
      await expect(page.locator('.net-ruler')).toHaveCount(1);
    }
  }
});

const rows = (page: Page) => page.getByRole('grid', { name: 'Network requests' }).locator('.net-body [role="row"]');

async function checkSearch(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Filter requests' });
  await search.fill('check');
  await search.fill('checkout');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('/api/checkout');
  await search.fill('not-a-request');
  await expect(page.getByText('No requests match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(search).toHaveValue('');
  await expect(rows(page)).toHaveCount(2);
  await search.fill('checkout');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows(page)).toHaveCount(2);
}

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
