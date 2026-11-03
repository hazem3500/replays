import { expect, type Page } from '@playwright/test';

import { createSuite, gotoHydrated, uniqueId } from './support.ts';

interface HandoffCapture {
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

/** In the page: slows and records comparison cover decodes, and logs the focused tile's phase and size as it changes. */
export function watchCoverDecode(decodeDelay: number) {
  const decode = Reflect.get(HTMLImageElement.prototype, 'decode') as (this: HTMLImageElement) => Promise<void>;
  const decoded = new WeakSet<HTMLImageElement>();
  const decodeState = { fulfilled: 0 };
  HTMLImageElement.prototype.decode = async function (this: HTMLImageElement) {
    await decode.call(this);
    if (!this.matches('.ct-cover')) return;
    // why: decoded-image cache reuse must not bypass this slow browser decode boundary.
    if (decodeDelay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, decodeDelay));
    decoded.add(this);
    decodeState.fulfilled++;
  };
  let previous = '';
  const timeline: Array<{ elapsed: number; phase: string; width: number; height: number }> = [];
  const observer = new MutationObserver(() => {
    const picture = document.querySelector('.ct-tile[data-current] .ct-picture');
    const rect = picture?.getBoundingClientRect();
    let phase = document.querySelector('.skeleton-shell') ? 'skeleton' : 'pending';
    if (picture) phase = 'comparison';
    const state = `${phase}:${rect?.width}:${rect?.height}`;
    if (state === previous) return;
    previous = state;
    const started = Number(Reflect.get(window, 'coldSuiteStarted') ?? 0);
    timeline.push({ elapsed: performance.now() - started, phase, width: rect?.width ?? 0, height: rect?.height ?? 0 });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-current'] });
  Object.assign(window, {
    coldSuiteTimeline: timeline,
    coldSuiteObserver: observer,
    coldSuiteDecodeState: decodeState,
    coldSuiteDecoded: decoded,
  });
}

/** In the page: records what the view transition's new snapshot sees once the navigation has committed. */
export function captureHandoff() {
  const start = document.startViewTransition.bind(document);
  const decoded = Reflect.get(window, 'coldSuiteDecoded') as WeakSet<HTMLImageElement>;
  const captures: HandoffCapture[] = [];
  Object.assign(window, { coldSuiteCaptures: captures });
  document.startViewTransition = (update) => {
    const started = performance.now();
    Object.assign(window, { coldSuiteStarted: started });
    const source = document.querySelector<HTMLElement>(
      '[style*="view-transition-name: vt-page-hero"], [style*="view-transition-name: vt-page-sheet-"]',
    )?.tagName;
    const transition = start(async () => {
      if (typeof update !== 'function') throw new Error('Expected a navigation commit callback');
      await update();
      const picture = document.querySelector('.ct-tile[data-current] .ct-picture');
      const cover = picture?.querySelector<HTMLImageElement>('.ct-cover');
      const rect = picture?.getBoundingClientRect() ?? new DOMRect();
      captures.push({
        source,
        elapsed: performance.now() - started,
        real: Boolean(picture),
        hero:
          picture instanceof HTMLElement &&
          (picture.style.viewTransitionName === 'vt-page-hero' || picture.style.viewTransitionName.startsWith('vt-page-sheet-')),
        paired: document.documentElement.dataset.pageHero,
        coverReady: Boolean(cover?.complete && cover.naturalWidth > 0),
        coverDecoded: Boolean(cover && decoded.has(cover)),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    });
    void transition.finished.then(() => {
      Object.assign(window, { coldSuiteHandoffPlayers: document.querySelectorAll('.ct-tile iframe').length });
    });
    return transition;
  };
}

/** The one view transition captured a decoded, laid out cover at the comparison tile's final rect, or a cold suite fell back. */
export async function expectSuiteHandoff(page: Page, warm: boolean) {
  const capture = (await page.evaluate(() => Reflect.get(window, 'coldSuiteCaptures') as unknown)) as HandoffCapture[];
  const diagnostics = await page.evaluate(() => {
    const observer = Reflect.get(window, 'coldSuiteObserver');
    if (observer instanceof MutationObserver) observer.disconnect();
    return {
      timeline: Reflect.get(window, 'coldSuiteTimeline') as unknown,
      decode: Reflect.get(window, 'coldSuiteDecodeState') as { fulfilled: number },
    };
  });
  expect(capture).toHaveLength(1);
  expect(await page.evaluate(() => Reflect.get(window, 'coldSuiteHandoffPlayers') as unknown)).toBe(0);
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
