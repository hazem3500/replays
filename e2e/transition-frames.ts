import { expect, type Page } from '@playwright/test';

import { createSuite, gotoHydrated, uniqueId } from './support.ts';

/** One shared picture's layers on one frame of a page transition. */
export interface LayerFrame {
  name: string;
  running: boolean;
  /** The group's on-screen rectangle: its fixed canvas under the animated transform. */
  rect: { x: number; y: number; width: number; height: number };
  /** The group animation's eased progress: past 1 while its spring overshoots. */
  progress: number;
  /** The scale the group's own keyframes put it at for its current progress, when they are a translate and a scale. */
  expectedScale: number | undefined;
  scale: number;
  old: number | undefined;
  new: number | undefined;
}

export interface TransitionFrames {
  frames: Array<{ elapsed: number; layers: LayerFrame[] }>;
  finishedAfter: number | undefined;
  /** Each picture as it was when a newer page change skipped this transition. */
  skipped?: LayerFrame[];
}

declare global {
  interface Window {
    transitionFrames?: TransitionFrames[];
  }
}

const POSTER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#3b6ea5"/><rect x="80" y="80" width="640" height="340" fill="#f2c14e"/></svg>';

/** Serves an opaque, two-tone poster for the given replays, so a see-through layer would show. */
export async function routePosters(page: Page, replayPrefix: string) {
  await page.route(`**/api/replays/${replayPrefix}*/poster?*`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: POSTER }));
}

/** Records every frame of every view transition the page starts: each shared picture's geometry and layer opacity. */
export function recordTransitionFrames() {
  const root = document.documentElement;
  const pictureLayer = /^::view-transition-group\((vt-page-[^)]+)\)$/;
  const scalePattern = /scale\(([^,)]+)/;
  const opacity = (pseudo: string) => {
    const running = document
      .getAnimations()
      .some((animation) => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement === pseudo);
    return running ? Number(getComputedStyle(root, pseudo).opacity) : undefined;
  };
  const layer = (animation: Animation, effect: KeyframeEffect, name: string): LayerFrame => {
    const style = getComputedStyle(root, `::view-transition-group(${name})`);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    const progress = effect.getComputedTiming().progress ?? 0;
    const stops = effect
      .getKeyframes()
      .flatMap(({ transform, computedOffset }) =>
        typeof transform === 'string' ? [{ offset: computedOffset, scale: Number(scalePattern.exec(transform)?.[1] ?? Number.NaN) }] : [],
      );
    // why: past the last stop a spring extrapolates along the final segment, as the browser does.
    const segment = stops.findIndex((stop, index) => index > 0 && (progress <= stop.offset || index === stops.length - 1));
    const [from, to] = [stops[segment - 1], stops[segment]];
    const expectedScale =
      from && to && !Number.isNaN(from.scale) && !Number.isNaN(to.scale)
        ? from.scale + ((to.scale - from.scale) * (progress - from.offset)) / (to.offset - from.offset)
        : undefined;
    return {
      name,
      running: animation.playState === 'running',
      rect: {
        x: matrix.e,
        y: matrix.f,
        width: Number.parseFloat(style.width) * matrix.a,
        height: Number.parseFloat(style.height) * matrix.d,
      },
      progress,
      expectedScale,
      scale: matrix.a,
      old: opacity(`::view-transition-old(${name})`),
      new: opacity(`::view-transition-new(${name})`),
    };
  };
  const layersNow = () => {
    const layers: LayerFrame[] = [];
    for (const animation of document.getAnimations()) {
      const effect = animation.effect;
      const name = effect instanceof KeyframeEffect ? pictureLayer.exec(effect.pseudoElement ?? '')?.[1] : undefined;
      if (!name || !(effect instanceof KeyframeEffect) || !(animation instanceof CSSAnimation)) continue;
      if (!layers.some((known) => known.name === name)) layers.push(layer(animation, effect, name));
    }
    return layers;
  };
  window.transitionFrames = [];
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (update) => {
    const record: TransitionFrames = { frames: [], finishedAfter: undefined };
    window.transitionFrames?.push(record);
    const began = performance.now();
    const transition = start(update);
    let done = false;
    const sample = () => {
      if (done) return;
      record.frames.push({ elapsed: performance.now() - began, layers: layersNow() });
      requestAnimationFrame(sample);
    };
    const skip = transition.skipTransition.bind(transition);
    transition.skipTransition = () => {
      record.skipped ??= layersNow();
      skip();
    };
    void transition.ready.then(
      () => requestAnimationFrame(sample),
      () => {},
    );
    void transition.finished.finally(() => {
      done = true;
      record.finishedAfter = performance.now() - began;
    });
    return transition;
  };
}

export const transitionFrames = (page: Page) => page.evaluate(() => window.transitionFrames ?? []);

/** Waits until no page transition runs. */
export async function landed(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
}

/** The lowest share of a picture's area that its two layers together cover, over every frame where both exist. */
export function lowestCoverage(record: TransitionFrames) {
  let lowest = 1;
  let crossfading = 0;
  for (const frame of record.frames)
    for (const layer of frame.layers) {
      if (layer.old === undefined || layer.new === undefined) continue;
      if (layer.new > 0.05 && layer.new < 0.95) crossfading++;
      lowest = Math.min(lowest, 1 - (1 - layer.old) * (1 - layer.new));
    }
  return { lowest, crossfading };
}

/** The largest overlap, in pixels along its narrower side, between any two flying pictures on one frame. */
export function largestOverlap(layers: readonly LayerFrame[]) {
  let largest = 0;
  for (const [index, a] of layers.entries())
    for (const b of layers.slice(index + 1)) {
      const width = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);
      const height = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);
      if (width > 0 && height > 0) largest = Math.max(largest, Math.min(width, height));
    }
  return largest;
}

/** The library with a four-recording suite, its posters loaded and the suite opened once, in the grid layout. */
export async function suiteLibrary(page: Page, base: string) {
  const suiteId = uniqueId('motion-suite');
  const ids = Array.from({ length: 4 }, (_, index) => `${suiteId}-${index}`);
  await createSuite(
    page.request,
    base,
    suiteId,
    ids.map((replayId, index) => ({ id: `run-${index}`, label: `Browser ${index + 1}`, status: 'passed' as const, replayId })),
  );
  await routePosters(page, suiteId);
  await gotoHydrated(page, base);
  await page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: 'Grid', exact: true }).click();
  const card = page.locator(`[data-entry-id="suite:${suiteId}"]`);
  await expect(card.locator('.poster > img').first()).toHaveJSProperty('complete', true);
  const link = card.locator('a.row-target');
  // why: a cold suite past its readiness budget opens with the plain page fade, which has no sheets to measure.
  await link.click();
  await expect(page.locator('.ct-tile iframe')).toHaveCount(4);
  await landed(page);
  await page.goBack();
  await expect(link).toBeVisible();
  await landed(page);
  return { card, link };
}
