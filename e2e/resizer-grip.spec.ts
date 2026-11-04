import { expect, test, type Locator } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

test.use({ viewport: { width: 1280, height: 800 } });

const centreX = async (locator: Locator) => {
  const box = await boxOf(locator);
  return box.x + box.width / 2;
};

test('the dock resizer grip appears where the pointer meets the seam and stays anchored until it hides', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const resizer = page.getByTestId('inspector-resizer');
  const grip = resizer.locator('.splitter-grip');
  const seam = await boxOf(resizer);
  const y = seam.y + seam.height / 2;

  await page.mouse.move(300, y - 80);
  await page.mouse.move(300, y);
  await expect(grip).toHaveCSS('opacity', '1');
  expect(Math.abs((await centreX(grip)) - 300)).toBeLessThanOrEqual(1);

  await page.mouse.move(700, y, { steps: 6 });
  expect(Math.abs((await centreX(grip)) - 300)).toBeLessThanOrEqual(1);

  await page.mouse.down();
  await page.mouse.move(760, y - 60, { steps: 4 });
  expect(Math.abs((await centreX(grip)) - 300)).toBeLessThanOrEqual(1);
  await page.mouse.up();
  expect(Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(0);

  await page.mouse.move(760, 200);
  await expect(grip).toHaveCSS('opacity', '0');

  // invariant: shown again near either end, the whole grip stays on the seam.
  const moved = await boxOf(resizer);
  const nextY = moved.y + moved.height / 2;
  await page.mouse.move(moved.x + 2, nextY);
  await expect(grip).toHaveCSS('opacity', '1');
  expect((await boxOf(grip)).x).toBeGreaterThanOrEqual(moved.x);
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
