import { expect, test, type Page } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

const THROWN = [
  "TypeError: Cannot read properties of undefined (reading 'total')",
  '    at renderSummary (https://shop.test/assets/app.js:212:31)',
  '    at Array.forEach (<anonymous>)',
].join('\n');
const LONG = `cart updated {"items":[{"sku":"tea-01","name":"Smoked pine tea","qty":1},{"sku":"mug-02","name":"Stoneware mug","qty":1}],"note":"${'x'.repeat(160)}"}`;

async function seed(page: Page, id: string) {
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Console fixture');
  const url = 'https://shop.test/checkout';
  bundle.console = [
    { at: 500, level: 'info', message: 'App booted', url },
    { at: 1000, level: 'log', message: LONG, url },
    { at: 2000, level: 'error', message: THROWN, url },
    { at: 3000, level: 'warn', message: 'Coupon lookup failed 404', url },
    { at: 3100, level: 'warn', message: 'Coupon lookup failed 404', url },
  ];
  await postBundle(page.request, server().origin, bundle);
}

test('a message opens whole: JSON indented, the stack as frames, its source and copy actions', async ({ page }) => {
  const id = uniqueId('console-detail');
  await seed(page, id);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('console-tab').click();

  await page.locator('[data-console-id]').filter({ hasText: 'cart updated' }).click();
  const detail = page.getByTestId('console-detail');
  await expect(detail.getByTestId('console-message')).toContainText('"name": "Stoneware mug"');
  await expect(detail.getByRole('button', { name: 'Copy message' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Copy with stack' })).toHaveCount(0);

  await page.locator('[data-console-id]').filter({ hasText: 'TypeError' }).click();
  await expect(detail).toContainText('Error');
  await expect(detail.getByTestId('console-message')).not.toContainText('renderSummary (');
  await expect(detail.getByRole('region', { name: 'Stack · 2 frames' })).toContainText('renderSummary');
  await expect(detail).toContainText('assets/app.js:212:31');
  await expect(detail.getByRole('button', { name: 'Copy with stack' })).toBeVisible();
  await detail.getByRole('button', { name: 'Watch from 0:02.0' }).click();
  await expect(page.getByTestId('playhead')).toHaveText('0:02.0');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
});

test('identical messages fold with a count, and the detail lists every time', async ({ page }) => {
  const id = uniqueId('console-repeats');
  await seed(page, id);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('console-tab').click();
  const folded = page.locator('[data-console-id]').filter({ hasText: 'Coupon lookup failed' });
  await expect(folded).toHaveCount(1);
  await expect(folded).toContainText('×2');
  await folded.click();
  await expect(page.getByTestId('console-detail').getByRole('region', { name: 'Logged 2 times' }).getByRole('button')).toHaveCount(2);
});

test('level chips filter and summarise, and search opens in place', async ({ page }) => {
  const id = uniqueId('console-filter');
  await seed(page, id);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('console-tab').click();
  const rows = page.locator('[data-console-id]');
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('console-level-warn')).toContainText('2');
  await page.getByTestId('console-level-error').click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId('console-level-error').click();
  await page.getByTestId('console-search-toggle').click();
  await page.getByRole('searchbox', { name: 'Search messages' }).fill('booted');
  await expect(rows).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(4);
});

test.describe('Console on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  test('a long message is a 48 px target that opens whole in place of the list, page included', async ({ page }) => {
    const id = uniqueId('console-phone');
    await seed(page, id);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('console-tab').tap();
    const row = page.locator('[data-console-id]').filter({ hasText: 'cart updated' });
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    await expect(page.locator('.cp-row').filter({ has: row }).locator('.cp-page')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await row.tap();
    const detail = page.getByTestId('console-detail');
    await expect(detail.getByTestId('console-message')).toContainText('x'.repeat(160));
    await expect(page.getByTestId('console-list')).toBeHidden();
    await detail.getByRole('button', { name: 'Back to the list' }).tap();
    await expect(page.getByTestId('console-list')).toBeVisible();
  });
});
