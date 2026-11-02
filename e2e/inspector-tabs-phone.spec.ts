import { expect, type Page, test } from '@playwright/test';

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

/** The space between the composer's last row (its field, or the note under it while typing) and the screen's bottom. */
function composerGap(page: Page) {
  return page.evaluate(() => {
    const rows = [...(document.querySelector('.comment-composer')?.children ?? [])].map((row) => row.getBoundingClientRect());
    const bottom = Math.max(...rows.filter((row) => row.height > 0).map((row) => row.bottom));
    return Math.round(innerHeight - bottom);
  });
}

test('on a phone the comment composer sits on the bottom safe area, 8 px over it, and drops it while typing', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  // why: edge-to-edge Chrome on Android reports the gesture bar as the bottom inset.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: 34 } });
  await page.getByRole('tab', { name: /^Comments/ }).tap();
  await expect(page.locator('.comment-composer-box')).toBeVisible();
  await expect.poll(() => composerGap(page)).toBe(34 + 8);

  await page.locator('.comment-composer-input').focus();
  await expect.poll(() => composerGap(page)).toBe(8);

  await page.locator('.comment-composer-input').blur();
  await page.getByTestId('inspector-collapse').tap();
  await expect(page.locator('.comment-composer-box')).toBeHidden();
  const shell = await page.locator('.app-shell[data-mobile]').evaluate((element) => getComputedStyle(element).paddingBottom);
  expect(shell).toBe('34px');
});
