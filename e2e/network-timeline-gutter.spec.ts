import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

test('network lane labels sit beside the plot when Network is the first tab opened', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const id = uniqueId('network-gutter');
  const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Network gutter fixture');
  await postBundle(page.request, server().origin, bundle);
  await openReplay(page, `${server().origin}/r/${id}`);
  await page.getByTestId('network-tab').click();
  const timeline = page.getByTestId('network-timeline');
  await expect(timeline).toBeVisible();

  const plot = await timeline.locator('.pt-plot').boundingBox();
  const labels = timeline.locator('.pt-label');
  const count = await labels.count();
  expect(plot).not.toBeNull();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const label = await labels.nth(index).boundingBox();
    expect((label?.x ?? 0) + (label?.width ?? 0)).toBeLessThanOrEqual((plot?.x ?? 0) + 1);
    expect(label?.y ?? 0).toBeGreaterThanOrEqual((plot?.y ?? 0) - 1);
  }
});
