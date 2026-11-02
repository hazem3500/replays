import { expect, test } from '@playwright/test';

import { openReplay, origin } from './support.ts';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('dragging Steps closed and reopening restores its saved width', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const rail = page.getByRole('complementary', { name: 'Steps' });
  const seam = page.getByRole('separator', { name: 'Resize steps panel' });
  await seam.press('End');
  await expect(seam).toHaveAttribute('aria-valuenow', '480');
  const before = (await rail.boundingBox())!.width;
  const handle = (await seam.boundingBox())!;
  await page.mouse.move(handle.x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(1275, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(rail).toBeHidden();
  await page.getByRole('button', { name: 'Show steps' }).click();
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBe(before);
  await page.reload();
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBe(before);
});

test('the collapsed Steps separator stays inside the viewport and can be dragged open', async ({ page }) => {
  await openReplay(page, `${origin()}/r/demo-shop`);
  const seam = page.getByRole('separator', { name: 'Resize steps panel' });
  await seam.press('Enter');
  await expect(seam).toHaveAttribute('aria-valuenow', '0');
  await expect(seam).toBeInViewport({ ratio: 1 });
  const handle = (await seam.boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('complementary', { name: 'Steps' })).toBeVisible();
  await expect(seam).not.toHaveAttribute('aria-valuenow', '0');
  await seam.press('Enter');
  await expect(seam).toHaveAttribute('aria-valuenow', '0');
  await seam.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Steps' })).toBeVisible();
});

for (const viewport of [
  { width: 800, height: 900 },
  { width: 1000, height: 540 },
]) {
  test(`Steps shares the inspector at ${viewport.width} by ${viewport.height} and keeps the chosen diagnostics tab across resize`, async ({
    page,
  }) => {
    await openReplay(page, `${origin()}/r/demo-shop`);
    await page.setViewportSize(viewport);
    const steps = page.getByTestId('steps-tab');
    await expect(page.getByRole('complementary', { name: 'Steps' })).toHaveCount(0);
    await expect(steps).toBeVisible();
    await steps.click();
    await expect(steps).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('step-timeline')).toBeVisible();
    await page.getByTestId('network-tab').click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(steps).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Steps' })).toBeVisible();
    await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize(viewport);
    await expect(steps).toBeVisible();
    await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('complementary', { name: 'Steps' })).toHaveCount(0);
  });
}
