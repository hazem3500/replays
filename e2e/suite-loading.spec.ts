import { expect, type Locator, test } from '@playwright/test';

import { createSuite, gotoHydrated, serveApp, uniqueId, COMPARE_SUITE_PROFILE, compareSuiteEnv } from './support.ts';

const server = serveApp(compareSuiteEnv);

function rects(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map(Math.round);
    }),
  );
}

/** Every box within 2 px of its counterpart. */
function near(boxes: number[][], expected: number[][]) {
  return (
    boxes.length === expected.length &&
    boxes.every((box, index) => box.every((value, axis) => Math.abs(value - (expected[index]?.[axis] ?? Infinity)) <= 2))
  );
}

test('a suite opened from its card loads with its runs listed and a tile where each recording lands', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const suite = uniqueId('loading-suite');
  await createSuite(
    page.request,
    server().origin,
    suite,
    [
      { id: 'attempt-1', label: 'Desktop', status: 'passed', replayId: `${suite}-one` },
      { id: 'attempt-2', label: 'Phone', status: 'failed', replayId: `${suite}-two` },
      { id: 'attempt-3', label: 'Tablet', status: 'passed', replayId: `${suite}-three` },
      { id: 'attempt-4', label: 'Waiting', status: 'passed' },
    ],
    undefined,
    { profile: COMPARE_SUITE_PROFILE },
  );
  await gotoHydrated(page, `${server().origin}/`);
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
  await expect.poll(async () => near(await rects(tiles), before)).toBe(true);
});
