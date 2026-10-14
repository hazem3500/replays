import { expect, type Page, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

const viewer = () => `${origin()}/r/demo-shop`;

async function open(page: Page) {
  await openReplay(page, viewer());
  const seek = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
  return { seek, y: seek.y + seek.height / 2 };
}

const bubble = (page: Page) => page.getByTestId('scrubber-bubble');
const label = (page: Page) => page.getByTestId('scrubber-bubble-label');
const time = (page: Page) => page.getByTestId('scrubber-bubble-time');

test('at rest: one rounded bar per step, no bubble', async ({ page }) => {
  await open(page);
  await page.mouse.move(5, 5);
  const bars = page.getByTestId('scrubber-segment');
  expect(await bars.count()).toBeGreaterThan(1);
  await expect(bars.first()).toHaveCSS('border-radius', '3px');
  await expect(bubble(page)).toHaveAttribute('data-visible', 'false');
  expect((await bars.first().boundingBox())!.height).toBeCloseTo(4, 0);
});

test('hovering shows the time, then names the step under the pointer, in one bubble', async ({ page }) => {
  const { seek, y } = await open(page);
  await page.mouse.move(seek.x + seek.width * 0.1, y);
  await expect(bubble(page)).toHaveAttribute('data-visible', 'true');
  await expect(time(page)).toHaveText(/^\d+:\d{2}\.\d$/);

  // Resting on a bar names its step once the pointer has stayed for a moment.
  const bar = (await page.getByTestId('scrubber-segment').nth(1).boundingBox())!;
  await page.mouse.move(bar.x + Math.min(10, bar.width / 2), y, { steps: 4 });
  await expect(bubble(page)).toHaveAttribute('data-kind', 'step');
  await expect(label(page)).not.toBeEmpty();
  await expect(time(page)).toHaveText(/^\d+:\d{2}\.\d$/);
  await expect(page.locator('.scrubber-bubble')).toHaveCount(1);

  // While dragging the bubble shows only the time, and it follows the playhead.
  await page.mouse.down();
  await expect(bubble(page)).toHaveAttribute('data-kind', 'time');
  await page.mouse.move(bar.x + 60, y, { steps: 4 });
  await expect(time(page)).toHaveText(await page.getByTestId('playhead').innerText());
  await page.mouse.up();
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');

  await page.mouse.move(5, 5);
  await expect(bubble(page)).toHaveAttribute('data-visible', 'false');
});

test('clicking the track seeks to that point', async ({ page }) => {
  const { seek, y } = await open(page);
  await page.mouse.click(seek.x + seek.width * 0.5, y);
  // Half of the 8.6 s replay (the readout settles after a short glide).
  await expect
    .poll(async () => {
      const [minutes, seconds] = (await page.getByTestId('playhead').innerText()).split(':');
      return Number(minutes) * 60 + Number(seconds);
    })
    .toBeGreaterThan(3.5);
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', /^0:0[3-5]\.\d of /);
});

test('keyboard seeks without a hover bubble, but names a step it lands on', async ({ page }) => {
  await open(page);
  await page.mouse.move(5, 5);
  const slider = page.getByRole('slider', { name: 'Seek' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('playhead')).toHaveText('0:01.0');
  await expect(slider).toHaveAttribute('aria-valuetext', /^0:01\.0 of /);
  await expect(bubble(page)).toHaveAttribute('data-visible', 'false');
  // `]` lands exactly on the next step: the bubble names it and the polite region announces it.
  await page.keyboard.press(']');
  await expect(bubble(page)).toHaveAttribute('data-visible', 'true');
  await expect(bubble(page)).toHaveAttribute('data-kind', 'step');
  await expect(label(page)).not.toBeEmpty();
  await expect(page.getByTestId('step-announcer')).toContainText(/^Step \d+ of \d+: /);
  await page.keyboard.press('Tab');
  await expect(bubble(page)).toHaveAttribute('data-visible', 'false');
});

test('a touch drag scrubs without scrolling the page and shows the time above the finger', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const { seek, y } = await open(page);
  expect(seek.height).toBeGreaterThanOrEqual(40);
  const scrollBefore = await page.evaluate(() => document.scrollingElement!.scrollTop);
  const cdp = await context.newCDPSession(page);
  const at = (ratio: number) => seek.x + seek.width * ratio;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at(0.2), y }] });
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at(0.2 + step * 0.08), y: y - step }] });
  }
  await expect(bubble(page)).toHaveAttribute('data-visible', 'true');
  // Well clear of the finger: the bubble's bottom sits at least 24 px above the touch point.
  const shown = (await bubble(page).boundingBox())!;
  expect(y - (shown.y + shown.height)).toBeGreaterThanOrEqual(24);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(bubble(page)).toHaveAttribute('data-visible', 'false');
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(scrollBefore);
  await context.close();
});

test('the error notch shows on hover and with the Console and Network tabs, and the bubble names it', async ({ page }) => {
  const { seek, y } = await open(page);
  await page.getByTestId('performance-tab').click();
  await page.mouse.move(5, 5);
  const notch = page.getByTestId('error-marker');
  await expect(notch).toHaveCount(1);
  await expect(notch).toHaveCSS('opacity', '0');
  // Under the pointer it shows; it hides again when the pointer leaves.
  await page.mouse.move(seek.x + seek.width / 2, y);
  await expect(notch).toHaveCSS('opacity', '1');
  await page.mouse.move(5, 5);
  await expect(notch).toHaveCSS('opacity', '0');
  // The Console and Network tabs keep the notch on.
  await page.getByTestId('network-tab').click();
  await page.mouse.move(5, 5);
  await expect(notch).toHaveCSS('opacity', '1');
  await page.getByTestId('console-tab').click();
  await expect(notch).toHaveCSS('opacity', '1');
  await page.getByTestId('performance-tab').click();
  await page.mouse.move(5, 5);
  await expect(notch).toHaveCSS('opacity', '0');
  // Resting on the notch names the error.
  const mark = (await notch.boundingBox())!;
  await page.mouse.move(mark.x + mark.width / 2, y, { steps: 4 });
  await expect(bubble(page)).toHaveAttribute('data-kind', 'error');
  await expect(label(page)).toContainText(/2 errors .*\/api\/coupons\/SPRING10 failed \(404/);
});
