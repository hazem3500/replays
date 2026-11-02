import { expect, type Page, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

const shop = () => `${origin()}/r/demo-shop`;
const requests = (page: Page) => page.getByRole('grid', { name: 'Network requests' }).locator('.net-body [role="row"]');

test('Issues is the landing tab and explains the failed coupon request', async ({ page }) => {
  await openReplay(page, shop());
  await expect(page.getByTestId('issues-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('issues-headline')).toHaveText(
    'The server rejected “Apply the coupon” (404) and “Place the order” was slow to respond (208 ms) because the page was busy.',
  );
  const panel = page.getByTestId('issues-panel');
  await expect(panel.locator('.issue-card')).toHaveCount(2);
  const evidence = page.getByTestId('issue-evidence');
  await expect(evidence).toContainText('Likely Backend');
  await expect(evidence.locator('.issue-link')).toHaveText([
    /Apply the coupon/,
    /GET \/api\/coupons\/SPRING10.*404/,
    /coupon lookup failed 404/,
    /Coupon service answered 404/,
    /Read the coupon error/,
  ]);
});

test('Open in Network selects the failed request in the Network table', async ({ page }) => {
  await openReplay(page, shop());
  await page.getByTestId('issue-evidence').getByRole('button', { name: 'Open in Network' }).click();
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
  const selected = requests(page).and(page.locator('[aria-selected="true"]'));
  await expect(selected).toContainText('/api/coupons/SPRING10');
  await expect(page.getByTestId('request-detail')).toContainText('404');
  await selected.press('Escape');
  await expect(page.getByTestId('request-detail')).toBeHidden();
});

test('Open in Performance selects the slow interaction behind a slow click', async ({ page }) => {
  await openReplay(page, shop());
  await page.getByTestId('issues-panel').locator('.issue-card').filter({ hasText: 'Place the order' }).click();
  await page.getByTestId('issue-evidence').getByRole('button', { name: 'Open in Performance' }).click();
  await expect(page.getByTestId('performance-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Selected performance event' })).toContainText('Slow interaction');
});

test('the Network table filters by status and type, selects with the keyboard and zooms the Timing column', async ({ page }) => {
  await openReplay(page, shop());
  await page.getByTestId('network-tab').click();
  await expect(requests(page)).toHaveCount(8);

  await page.getByRole('group', { name: 'Request status' }).getByRole('button', { name: 'Failed' }).click();
  await expect(requests(page)).toHaveCount(1);
  await page.getByRole('group', { name: 'Request status' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('group', { name: 'Request type' }).getByRole('button', { name: 'CSS' }).click();
  await expect(requests(page)).toHaveCount(2);
  await page.getByRole('group', { name: 'Request type' }).getByRole('button', { name: 'All' }).click();

  await requests(page).first().click();
  await expect(page.getByTestId('request-detail')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(requests(page).nth(1)).toBeFocused();
  await expect(requests(page).nth(1)).toHaveAttribute('aria-selected', 'true');

  const ruler = page.locator('.net-ruler-track');
  const box = (await ruler.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const reset = page.locator('.net-ruler-reset');
  await expect(reset).toContainText('Reset');
  await expect(requests(page)).toHaveCount(4);
  await reset.click();
  await expect(requests(page)).toHaveCount(8);
});
