import { expect, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.use({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });

test('mobile GitHub source keeps a clean filled mark, a 40 px target and its accessible link', async ({ page }) => {
  const url = 'https://github.com/example-org/shop-demo/pull/9';
  await page.route('**/api/replays/demo-shop', async (route) => {
    const response = await route.fetch();
    const bundle = await response.json();
    bundle.context = {
      ...bundle.context,
      version: 1,
      capturedAt: bundle.context?.capturedAt ?? new Date().toISOString(),
      sources: [{ provider: 'github', url, label: 'Shop PR #9' }],
    };
    await route.fulfill({ response, json: bundle });
  });
  await openReplay(page, `${origin()}/r/demo-shop`);
  const chip = page.getByTestId('source-chip');
  await expect(chip).toHaveAttribute('href', url);
  await expect(chip).toHaveAttribute('target', '_blank');
  await expect(chip).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(chip).toHaveAccessibleName(/Shop PR #9.*opens in a new tab/);
  await expect(chip).toHaveCSS('width', '40px');
  await expect(chip).toHaveCSS('height', '40px');
  const mark = chip.locator('[data-provider-mark="github"]');
  await expect(mark).toHaveCSS('width', '16px');
  await expect(mark).toHaveCSS('height', '16px');
  await expect(mark).toHaveAttribute('viewBox', '0 0 24 24');
  await expect(mark.locator('path')).toHaveCSS('stroke', 'none');
  expect(await mark.locator('path').evaluate((path) => getComputedStyle(path).fill === getComputedStyle(path).color)).toBe(true);
  await expect(chip.locator('span')).toBeHidden();
  await expect(chip.locator('svg').last()).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
