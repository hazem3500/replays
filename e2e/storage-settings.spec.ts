import { expect, test } from '@playwright/test';

import { gotoHydrated, origin } from './support.ts';

test('bulk deletion requires confirmation and reports protected recordings', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/data-storage', (route) =>
    route.fulfill({
      json: {
        backend: 'local',
        replayCount: 3,
        retention: { days: 30, profiles: {}, hasRules: false, expiredDays: 7, trashDays: 7 },
        trash: [],
      },
    }),
  );
  await page.route('**/api/data-storage/trash', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ confirm: 'trash-all' });
    writes += 1;
    await route.fulfill({ json: { trashed: 2, protected: 1, unavailable: 0, failed: 0 } });
  });
  await gotoHydrated(page, origin());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Data & storage' }).click();
  await expect(settings.getByText('Trash is empty', { exact: true })).toBeVisible();
  await expect(settings.getByRole('textbox', { name: 'Replay ID' })).toHaveCount(0);
  const remove = settings.getByRole('button', { name: 'Delete all replays', exact: true });
  await remove.click();
  const confirmation = page.getByRole('dialog', { name: 'Delete all replays?' });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toBe(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirmation.getByRole('button', { name: 'Delete all replays', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(settings.getByRole('status')).toHaveText('2 replays moved to trash. 1 kept.');
  expect(writes).toBe(1);
});
