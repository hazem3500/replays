import { expect, test } from '@playwright/test';

import { cloneBundle, openReplay, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp();

test.describe('network timeline', () => {
  test('lane labels sit beside the plot when Network is the first tab opened', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = uniqueId('network-gutter');
    const bundle = await cloneBundle(page.request, server().origin, 'demo-shop', id, 'Network gutter fixture');
    await postBundle(page.request, server().origin, bundle);
    await openReplay(page, `${server().origin}/r/${id}`);
    await page.getByTestId('network-tab').click();
    const timeline = page.getByTestId('network-timeline');
    await expect(timeline).toBeVisible();

    const plot = await timeline.locator('.pt-plot').boundingBox();
    const labels = await timeline.locator('.pt-label').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
    expect(plot).not.toBeNull();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.right).toBeLessThanOrEqual((plot?.x ?? 0) + 1);
      expect(label.top).toBeGreaterThanOrEqual((plot?.y ?? 0) - 1);
    }
  });
});
