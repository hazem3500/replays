import { expect, type Page, test } from '@playwright/test';

import { gotoHydrated, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

interface Frame {
  x: number;
  y: number;
}

/** Records where the open shared tooltip's positioner is on each of the next `count` animation frames. */
async function recordFrames(page: Page, count: number) {
  await page.evaluate((frames) => {
    const rects: (Frame | null)[] = [];
    Object.assign(window, { tipFrames: rects });
    const sample = () => {
      const box = document.querySelector('.tip-morph-positioner[data-open]')?.getBoundingClientRect();
      rects.push(box ? { x: Math.round(box.x), y: Math.round(box.y) } : null);
      if (rects.length < frames) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, count);
}

async function recordedFrames(page: Page, count: number) {
  await page.waitForFunction((frames) => (window as unknown as { tipFrames: unknown[] }).tipFrames.length >= frames, count);
  const frames = await page.evaluate(() => (window as unknown as { tipFrames: (Frame | null)[] }).tipFrames);
  return frames.filter((frame): frame is Frame => frame !== null);
}

const button = (page: Page, name: string) => page.locator('.index-shell').getByRole('button', { name, exact: true });

test('a tooltip opens where it belongs on a slow machine instead of flying in from a corner', async ({ page, context }) => {
  await gotoHydrated(page, `${origin()}/`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await recordFrames(page, 40);
  await button(page, 'Settings').hover();
  const frames = await recordedFrames(page, 40);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const settled = frames.at(-1);
  expect(settled).toBeDefined();
  for (const frame of frames) expect(frame).toEqual(settled);
});

test('a tooltip still glides between neighbouring triggers once it is showing', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/`);
  await button(page, 'Upload').hover();
  await expect(page.locator('.tip-morph-positioner[data-open]')).toBeVisible();
  await page.waitForTimeout(300);
  const from = await page.locator('.tip-morph-positioner').boundingBox();
  await recordFrames(page, 30);
  await button(page, 'Settings').hover();
  const frames = await recordedFrames(page, 30);
  const to = frames.at(-1);
  expect(from && to && to.x > from.x).toBe(true);
  expect(frames.some((frame) => from && to && frame.x > Math.round(from.x) + 1 && frame.x < to.x - 1)).toBe(true);
});
