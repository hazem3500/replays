import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

test('“Compare with…” in the viewer’s menu offers likely matches first and opens both on one timeline', async ({ page }) => {
  const before = uniqueId('checkout-before');
  const after = uniqueId('checkout-after');
  for (const [id, title] of [
    [before, `Checkout ${before} · before`],
    [after, `Checkout ${before} · after`],
  ] as const)
    await postBundle(page.request, server().origin, await cloneBundle(page.request, server().origin, 'demo-shop', id, title));
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${server().origin}/r/${before}`);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('compare-with').click();
  const picker = page.getByTestId('compare-picker');
  const similar = picker.getByRole('region', { name: 'Likely matches' });
  await expect(similar.getByRole('link').first()).toContainText(`Checkout ${before} · after`);
  await similar.getByRole('link', { name: new RegExp(`· after`) }).click();

  await expect(page).toHaveURL(new RegExp(`/compare\\?ids=${before},${after}`));
  await expect(page.locator('.mt-tile')).toHaveCount(2);
});
