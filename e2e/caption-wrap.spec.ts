import { expect, type Locator, type Page, test } from '@playwright/test';

import { isRecord } from '../src/shared/validate.ts';
import { boxOf, openReplay, origin } from './support.ts';

const LONG_LABEL = `Clicked “asdadasd, 10:00 AM–1:15 PM, 3h 15m ${'asdadasd asdasd '.repeat(10)}…”`;

async function openLongCaption(page: Page) {
  await page.route('**/api/replays/demo-shop', async (route) => {
    const response = await route.fetch();
    const bundle: unknown = await response.json();
    if (!isRecord(bundle)) throw new Error('the demo replay is not a bundle');
    await route.fulfill({ response, json: { ...bundle, steps: [{ at: 0, kind: 'click', label: LONG_LABEL }] } });
  });
  await page.addInitScript(() => localStorage.setItem('replays-view:standard:captions', '1'));
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByTestId('step-timeline').locator('[data-step-index="0"]').click();
  const caption = page.getByTestId('step-caption');
  await expect(caption).toHaveAttribute('data-active', 'true');
  return caption;
}

/** The text-overflow of the caption pill and each of its text layers ('missing' for a layer not rendered). */
async function captionOverflow(caption: Locator) {
  return caption.evaluate((host) =>
    ['.step-caption-text', '.step-caption-label', '.caption-morph', '.caption-swap'].map((name) => {
      const element = host.querySelector(name);
      return element ? getComputedStyle(element).textOverflow : 'missing';
    }),
  );
}

for (const [width, height, mobile] of [
  [1280, 800, false],
  [390, 844, true],
] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });

    test('a long step caption wraps to at most two lines and never shows an ellipsis', async ({ page }) => {
      const caption = await openLongCaption(page);
      const label = caption.locator('.step-caption-label');
      await expect(label).not.toContainText('…');
      const styles = await captionOverflow(caption);
      expect(styles).not.toContain('ellipsis');
      expect(styles).not.toContain('missing');
      const lineHeight = await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
      const { height: shown } = await boxOf(label);
      expect(shown).toBeLessThanOrEqual(lineHeight * 2 + 1);
      expect(shown).toBeGreaterThan(lineHeight * 1.5);
      const player = await boxOf(page.getByTestId('replay-player'));
      const pill = await boxOf(caption.locator('.step-caption-text'));
      expect(pill.x).toBeGreaterThanOrEqual(player.x);
      expect(pill.x + pill.width).toBeLessThanOrEqual(player.x + player.width);
    });
  });
}
