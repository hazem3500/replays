import { expect, type Locator, type Page, test } from '@playwright/test';

import { boxOf, createSuite, openReplay, serveApp, uniqueId } from './support.ts';

const server = serveApp();

async function captionsOn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('replays-captions', '1');
  });
}

/** Plays from the start and waits for the step caption in `scope` to show while a step is under way; returns its pill. */
async function playToCaption(page: Page, scope: Page | Locator = page) {
  await expect(page.getByRole('button', { name: /Hide step captions/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const pill = scope.locator('[data-testid="step-caption"][data-active="true"] .step-caption-text');
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await expect(pill).toHaveCount(1);
  return pill;
}

function inside(inner: { x: number; y: number; width: number; height: number }, outer: typeof inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

for (const [width, height, mobile] of [
  [1280, 800, false],
  [390, 844, true],
] as const) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });

    test('with captions on, a replay on its own shows the step caption on its frame mid-step', async ({ page }) => {
      await captionsOn(page);
      await openReplay(page, `${server().origin}/r/demo-shop`);
      const pill = await playToCaption(page);
      expect(inside(await boxOf(pill), await boxOf(page.getByTestId('replay-player')))).toBe(true);
    });

    test('with captions on, a compared suite shows the step caption on its focused tile mid-step', async ({ page }) => {
      const suite = uniqueId('captions');
      await createSuite(page.request, server().origin, suite, [
        { id: 'attempt-1', label: 'Before', status: 'passed', replayId: `${suite}-before` },
        { id: 'attempt-2', label: 'After', status: 'passed', replayId: `${suite}-after` },
      ]);
      await captionsOn(page);
      await openReplay(page, `${server().origin}/s/${suite}?view=compare`);
      await expect(page.getByTestId('compare-stage')).toBeVisible();
      // why: since every compare tile captions its own recording, only the focused tile's caption is checked here.
      const focused = page.locator('.ct-tile[data-current]');
      const pill = await playToCaption(page, focused);
      expect(inside(await boxOf(pill), await boxOf(focused))).toBe(true);
    });
  });
}
