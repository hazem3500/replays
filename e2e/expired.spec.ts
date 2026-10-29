import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

const records = {
  days: 30,
  records: [
    {
      id: 'old-checkout',
      title: 'Checkout with a declined card',
      host: 'shop.example',
      capturedAt: '2026-07-20T10:00:00.000Z',
      expiredAt: '2026-10-20T10:00:00.000Z',
      retentionDays: 90,
    },
  ],
};

test('the index says what expired and shows it, details only, on request', async ({ page }) => {
  await page.route('**/api/expired-replays', (route) => route.fulfill({ json: records }));
  await page.goto(`${origin()}/`);
  const section = page.getByRole('region', { name: 'Expired replays' });
  await expect(section).toContainText('1 replay expired in the last 30 days');
  await expect(section.getByText('Checkout with a declined card')).toBeHidden();
  await section.getByRole('button', { name: 'Show expired' }).click();
  await expect(section.getByText('Checkout with a declined card')).toBeVisible();
  await expect(section).toContainText('after 90 days');
  await expect(section.getByRole('link')).toHaveCount(0);
  await section.getByRole('button', { name: 'Hide expired' }).click();
  await expect(section.getByText('Checkout with a declined card')).toBeHidden();
});

test('a deployment without records shows no expired section', async ({ page }) => {
  await page.route('**/api/expired-replays', (route) => route.fulfill({ json: { days: 0, records: [] } }));
  await page.goto(`${origin()}/`);
  await expect(page.getByRole('link', { name: /^Demo shop/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Expired replays' })).toHaveCount(0);
});
