import { expect, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

test('quarter speed is offered, selected, and reachable by keyboard', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const menu = page.getByRole('button', { name: /^Playback: / });
  await menu.click();
  const rate = page.getByRole('slider', { name: 'Playback speed' });
  await rate.press('Home');
  await expect(page.getByTestId('speed-tag')).toHaveText('0.25×');
  await expect(rate).toHaveAttribute('aria-valuetext', '0.25×');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Playback' })).toHaveCount(0);
  await page.keyboard.press('>');
  await expect(page.getByTestId('speed-tag')).toHaveText('0.5×');
  await page.keyboard.press('<');
  await expect(page.getByTestId('speed-tag')).toHaveText('0.25×');
  await page.keyboard.press('<');
  await expect(page.getByTestId('speed-tag')).toHaveText('0.25×');
});

test('the speed handle stays centered on its track after changing the value', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByRole('button', { name: /^Playback: / }).click();
  const rate = page.getByRole('slider', { name: 'Playback speed' });
  for (const key of ['ArrowRight', 'End']) {
    await rate.press(key);
    await expect
      .poll(async () => {
        const track = await page.locator('.playback-rate-slider [data-slot="slider-track"]').boundingBox();
        const thumb = await page.locator('.playback-rate-slider [data-slot="slider-thumb"]').boundingBox();
        if (!track || !thumb) throw new Error('Playback slider must remain visible');
        return Math.abs(thumb.y + thumb.height / 2 - track.y - track.height / 2);
      })
      .toBeLessThanOrEqual(0.5);
  }
  await expect(rate).toHaveAttribute('aria-valuetext', '4×');
});

test('held captions retain their label while the number follows legacy wait and repeated action steps', async ({ page }) => {
  await page.route('**/api/replays/demo-shop', async (route) => {
    const response = await route.fetch();
    const bundle = await response.json();
    bundle.steps = [
      { at: 0, kind: 'click', label: 'Next month' },
      { at: 1000, kind: 'wait', label: 'Wait for the page' },
      { at: 2000, kind: 'click', label: 'Next month' },
      { at: 3000, kind: 'wait', label: 'Wait for export' },
    ];
    await route.fulfill({ response, json: bundle });
  });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await page.getByTestId('captions-switch').click();
  await page.getByTestId('captions-switch').click({ button: 'right' });
  await page.getByRole('switch', { name: 'Show step numbers' }).click();
  await page.keyboard.press('Escape');
  for (const [index, label] of [
    [1, 'Next month'],
    [2, 'Next month'],
    [3, 'Wait for export'],
  ] as const) {
    await page.getByTestId('step-timeline').locator(`[data-step-index="${index}"]`).click();
    const caption = page.getByTestId('step-caption');
    await expect(caption.locator('.step-caption-number')).toHaveText(String(index + 1));
    await expect(caption.locator('.step-caption-label')).toHaveText(label);
    await expect(page.getByTestId('step-count').locator('.visually-hidden')).toHaveText(`Step ${index + 1} of 4`);
  }
});
