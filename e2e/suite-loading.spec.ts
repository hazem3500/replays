import { expect, type Locator, test } from '@playwright/test';

import { createSuite, serveApp, uniqueId } from './support.ts';

const server = serveApp();

function rects(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(Math.round);
    }),
  );
}

test('a suite opened from its card loads with its runs listed and a tile where each recording lands', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const suite = uniqueId('loading-suite');
  await createSuite(page.request, server().origin, suite, [
    { id: 'attempt-1', label: 'Desktop', status: 'passed', replayId: `${suite}-one` },
    { id: 'attempt-2', label: 'Phone', status: 'failed', replayId: `${suite}-two` },
    { id: 'attempt-3', label: 'Tablet', status: 'passed', replayId: `${suite}-three` },
    { id: 'attempt-4', label: 'Waiting', status: 'passed' },
  ]);
  await page.goto(`${server().origin}/`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(new RegExp(`/api/suites/${suite}`), async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('link', { name: new RegExp(`^Review ${suite},`) }).click();

  const skeleton = page.locator('.skeleton-suite');
  await expect(skeleton.locator('.suite-sidebar h2')).toHaveText(`Review ${suite}`);
  await expect(skeleton.locator('.sk-run')).toHaveCount(4);
  await expect(skeleton.locator('.sk-layout-switch')).toBeVisible();
  const stand = skeleton.locator('.sk-tile');
  await expect(stand).toHaveCount(3);
  const before = await rects(stand);

  release();
  await expect(skeleton).toHaveCount(0);
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  await expect(tiles).toHaveCount(3);
  await expect
    .poll(async () => {
      const after = await rects(tiles);
      return after.every((box, index) => box.every((value, axis) => Math.abs(value - (before[index]?.[axis] ?? Infinity)) <= 2));
    })
    .toBe(true);
});
