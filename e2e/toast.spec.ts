import { expect, test } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

test('on desktop a short toast hugs its message, centred on the page', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByTestId('copy-link').click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Link copied' });
  await expect(toast).toBeVisible();
  const box = await boxOf(toast);
  expect(box.width).toBeLessThan(200);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
});
