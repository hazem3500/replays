import { expect, test, type Locator } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

const centreX = async (locator: Locator) => {
  const box = await boxOf(locator);
  return box.x + box.width / 2;
};

test('the dock resizer grip follows the pointer along the seam, stays under it while dragging and fades out on leave', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const resizer = page.getByTestId('inspector-resizer');
  const grip = resizer.locator('.splitter-grip');
  const seam = await boxOf(resizer);
  const y = seam.y + seam.height / 2;

  for (const x of [300, 700, 1100]) {
    await page.mouse.move(x, y);
    await expect(grip).toHaveCSS('opacity', '1');
    expect(Math.abs((await centreX(grip)) - x)).toBeLessThanOrEqual(1);
  }

  // invariant: near either end the whole grip stays on the seam.
  await page.mouse.move(seam.x + 2, y);
  expect((await boxOf(grip)).x).toBeGreaterThanOrEqual(seam.x);

  await page.mouse.move(500, y);
  await page.mouse.down();
  await page.mouse.move(640, y - 60, { steps: 4 });
  expect(Math.abs((await centreX(grip)) - 640)).toBeLessThanOrEqual(1);
  await page.mouse.up();
  const resized = await resizer.getAttribute('aria-valuenow');
  expect(Number(resized)).toBeGreaterThan(0);

  await page.mouse.move(640, 200);
  await expect(grip).toHaveCSS('opacity', '0');
});

test('keyboard focus shows the dock resizer grip without moving it', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const resizer = page.getByTestId('inspector-resizer');
  const grip = resizer.locator('.splitter-grip');
  await resizer.focus();
  await page.keyboard.press('ArrowUp');
  await expect(grip).toHaveCSS('opacity', '1');
  const seam = await boxOf(resizer);
  expect(Math.abs((await centreX(grip)) - (seam.x + seam.width / 2))).toBeLessThanOrEqual(1);
});
