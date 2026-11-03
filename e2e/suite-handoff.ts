import { expect, type Page } from '@playwright/test';

import { createSuite, gotoHydrated, uniqueId } from './support.ts';

declare global {
  interface Window {
    coldSuiteCaptures?: HandoffCapture[];
    coldSuiteObserver?: MutationObserver;
    coldSuiteTimeline?: Array<{ elapsed: number; phase: string; width: number; height: number }>;
    coldSuiteDecodeState?: { fulfilled: number };
    coldSuiteDecoded?: WeakSet<HTMLImageElement>;
    coldSuiteHandoffPlayers?: number;
    coldSuiteStarted?: number;
  }
}

export interface HandoffCapture {
  source: string | undefined;
  elapsed: number;
  real: boolean;
  hero: boolean;
  paired: string | undefined;
  coverReady: boolean;
  coverDecoded: boolean;
  rect: { x: number; y: number; width: number; height: number };
}

/** A four-run suite with instant posters, hovered on the index until its front poster has loaded; optionally warmed by one visit. */
export async function hoverSuiteCard(page: Page, origin: string, warm: boolean) {
  const suiteId = uniqueId('navigation-cold');
  const runs = Array.from({ length: 4 }, (_, index) => ({
    id: `run-${index}`,
    label: `Browser ${index + 1}`,
    status: 'passed' as const,
    replayId: `${suiteId}-${index}`,
  }));
  await createSuite(page.request, origin, suiteId, runs);
  await page.route(`**/api/replays/${suiteId}-*/poster?*`, async (route) => {
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/></svg>',
    });
  });
  await gotoHydrated(page, origin);
  const card = page.locator(`[data-entry-id="suite:${suiteId}"]`);
  const link = card.locator('a.row-target');
  await link.hover();
  await expect
    .poll(() =>
      card
        .locator('.suite-sheet > .shuffle-window > .poster:not(.poster-outgoing) > img, .stack-front > .poster > img')
        .first()
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  if (warm) {
    await link.click();
    await expect(page.locator('.ct-tile[data-current] iframe')).toBeAttached();
    await page.mouse.move(0, 0);
    await page.goBack();
    await expect(link).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
  }
  return link;
}

/** The one view transition captured a decoded, laid out cover at the comparison tile's final rect, or a cold suite fell back. */
export async function expectSuiteHandoff(page: Page, warm: boolean) {
  const capture = await page.evaluate(() => window.coldSuiteCaptures ?? []);
  const diagnostics = await page.evaluate(() => {
    window.coldSuiteObserver?.disconnect();
    return { timeline: window.coldSuiteTimeline, decode: window.coldSuiteDecodeState ?? { fulfilled: 0 } };
  });
  expect(capture).toHaveLength(1);
  expect(await page.evaluate(() => window.coldSuiteHandoffPlayers)).toBe(0);
  const [first] = capture;
  if (!first) throw new Error('Expected one captured page transition');
  expect(first.source).toMatch(/^(IMG|VIDEO|SPAN)$/);
  if (!warm && !first.hero) {
    expect(first.elapsed, JSON.stringify(diagnostics)).toBeGreaterThanOrEqual(500);
    expect(first.paired).toBeUndefined();
    return;
  }
  expect(diagnostics.decode.fulfilled).toBeGreaterThan(0);
  expect(first, JSON.stringify(diagnostics)).toMatchObject({
    source: expect.any(String),
    real: true,
    hero: true,
    coverReady: true,
    coverDecoded: true,
  });
  const final = await page.locator('.ct-tile[data-current] .ct-picture').boundingBox();
  if (!final) throw new Error('Expected the focused comparison frame to remain laid out');
  for (const dimension of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(first.rect[dimension] - final[dimension])).toBeLessThan(1);
}
