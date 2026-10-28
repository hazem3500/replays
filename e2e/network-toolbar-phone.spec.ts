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

    const toolbar = page.locator('.network-toolbar');
    await expect(toolbar).toBeVisible();
    expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width <= 600) {
      const targets = await toolbar.locator('button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      expect(targets.every(({ width: targetWidth, height: targetHeight }) => targetWidth >= 44 && targetHeight >= 44)).toBe(true);
    }

    await checkSearch(page);
    await page.getByTestId('network-filter-toggle').click();
    const popover = page.locator('.network-filter-popover');
    await expect(popover).toBeVisible();
    if (width <= 600) {
      await popover.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      const optionHeights = await popover
        .locator('.network-filter-option')
        .evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
      expect(optionHeights.every((optionHeight) => optionHeight >= 44)).toBe(true);
    }
    const bounds = await popover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(height);
    await popover.getByRole('button', { name: /Failed/ }).click();
    await expect(page.locator('.network-row')).toHaveCount(1);
    await expect(page.locator('.network-row').first()).toContainText('/api/checkout');
    await page.getByRole('button', { name: 'Clear active network filters' }).click();
    await expect(page.locator('.network-row')).toHaveCount(2);

    const timing = page.getByRole('button', { name: 'Show or hide request waterfall' });
    await timing.click();
    await expect(page.locator('.network-timing-heading')).toHaveCount(0);
    await timing.click();
    await expect(page.locator('.network-timing-heading')).toHaveCount(1);
  }
});

async function checkSearch(page: Page) {
  const searchToggle = page.getByTestId('network-search-toggle');
  await expect(page.locator('.network-search-panel input[type="search"]')).toBeDisabled();
  await searchToggle.click();
  const search = page.getByRole('searchbox', { name: 'Search network requests' });
  await expect(search).toBeFocused();
  await search.fill('check');
  await search.fill('checkout');
  if ((page.viewportSize()?.width ?? 1280) <= 600) {
    const searchTargets = await page
      .locator('.network-search-field button')
      .evaluateAll((buttons) =>
        buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
      );
    expect(searchTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
  }
  await expect(page.locator('.network-row')).toHaveCount(1);
  await expect(page.locator('.network-row').first()).toContainText('/api/checkout');
  await search.fill('not-a-request');
  await expect(page.getByText('No matching requests')).toBeVisible();
  await search.fill('');
  await expect(page.locator('.network-row')).toHaveCount(2);
  await search.fill('checkout');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(searchToggle).toBeFocused();
  // why: collapsed inert fields leave the accessible tree, so assert disabled state through the DOM locator.
  await expect(page.locator('.network-search-field input')).toBeDisabled();
  await expect(page.locator('.network-row')).toHaveCount(2);
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
