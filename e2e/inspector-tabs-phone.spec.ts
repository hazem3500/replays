import { expect, test } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

test('on a phone the inspector tabs are even 44 px cells, counts sit on the icon corner and the underline centres', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const tabs = page.locator('.inspector-tabs[data-icon-tabs] .inspector-tab');
  const widths = await tabs.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(44);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);

  const badged = tabs.filter({ has: page.locator('.tab-badge') }).first();
  await badged.tap();
  const icon = await boxOf(badged.locator('.inspector-tab-icon'));
  const badge = await boxOf(badged.locator('.tab-badge'));
  // why: anchored to the icon's top-right corner, overlapping it, never beside it.
  expect(badge.x).toBeGreaterThan(icon.x + icon.width / 2);
  expect(badge.x).toBeLessThan(icon.x + icon.width);
  expect(badge.y).toBeLessThan(icon.y);

  const tab = await boxOf(badged);
  const underline = await boxOf(page.locator('.inspector-tabs [data-slot="tabs-indicator"]'));
  expect(Math.abs(underline.x + underline.width / 2 - (tab.x + tab.width / 2))).toBeLessThanOrEqual(1);
});
