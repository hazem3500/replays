// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { feedTransition } from '../src/client/index/feed-transition.ts';

function tearDown() {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

async function namesLiveLayers() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(10_000);
  document.body.innerHTML = `
    <ul class="feed-list" data-view="list"><li data-entry-id="suite:demo">
      <div class="suite-sheet suite-sheet-outgoing" inert>
        <span class="stack-layer-1"></span>
        <span class="shuffle-window"><span class="poster"></span></span>
        <span class="feed-title">Outgoing</span>
      </div>
      <div class="suite-sheet" data-live>
        <span class="stack-layer-1"></span>
        <span class="shuffle-window"><span class="poster"></span></span>
        <span class="feed-title">Current</span>
        <span class="feed-cols">Today · example.test</span>
      </div>
    </li></ul>`;
  const start = vi.fn<(update: () => void) => { finished: Promise<void>; skipTransition: () => void }>((update) => {
    update();
    return { finished: Promise.resolve(), skipTransition: () => {} };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });

  feedTransition(() => {}, 'poster');

  expect(start).toHaveBeenCalledOnce();
  const live = document.querySelector('[data-live]');
  expect(live?.querySelector<HTMLElement>('.feed-title')?.style.getPropertyValue('view-transition-name')).toBe('title-suite_3ademo');
  expect(live?.querySelector<HTMLElement>('.poster')?.style.getPropertyValue('view-transition-name')).toBe('poster-suite_3ademo');
  expect(live?.querySelector<HTMLElement>('.feed-cols')?.style.getPropertyValue('view-transition-name')).toBe('aside-suite_3ademo');
  expect(live?.querySelector<HTMLElement>('.stack-layer-1')?.style.getPropertyValue('view-transition-name')).toBe('back1-suite_3ademo');
  expect(document.querySelector('.suite-sheet-outgoing [style*="view-transition-name"]')).toBeNull();
  await Promise.resolve();
}

async function synchronizesRearLayers() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(performance, 'now').mockReturnValue(20_000);
  document.body.innerHTML = `
    <ul class="feed-list" data-view="grid">
      <li data-entry-id="suite:first"><span class="card-back-1"></span><span class="card-back-2"></span></li>
      <li data-entry-id="suite:second"><span class="card-back-1"></span><span class="card-back-2"></span></li>
    </ul>`;
  const before: string[] = [];
  const start = vi.fn<(update: () => void) => { finished: Promise<void>; skipTransition: () => void }>((update) => {
    before.push(
      ...[...document.querySelectorAll<HTMLElement>('[class^="card-back"]')].map((sheet) =>
        sheet.style.getPropertyValue('view-transition-name'),
      ),
    );
    update();
    return { finished: Promise.resolve(), skipTransition: () => {} };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });

  feedTransition(() => {
    const list = document.querySelector<HTMLElement>('.feed-list');
    if (!list) throw new Error('Expected the feed list');
    list.dataset.view = 'list';
    for (const item of document.querySelectorAll('li')) {
      item.innerHTML = '<span class="poster-stack"><span class="stack-layer-1"></span><span class="stack-layer-2"></span></span>';
    }
  }, 'poster');

  expect(start).toHaveBeenCalledOnce();
  const after = [...document.querySelectorAll<HTMLElement>('[class^="stack-layer"]')].map((sheet) =>
    sheet.style.getPropertyValue('view-transition-name'),
  );
  expect(before).toEqual(['back1-suite_3afirst', 'back2-suite_3afirst', 'back1-suite_3asecond', 'back2-suite_3asecond']);
  expect(after).toEqual(before);
  const stagger = [...document.head.querySelectorAll('style')].find((style) => style.textContent?.includes('back1-suite_3asecond'));
  expect(stagger?.textContent).not.toContain('back1-suite_3afirst');
  expect(stagger?.textContent).toContain(
    '::view-transition-group(card-suite_3asecond), ::view-transition-old(card-suite_3asecond), ::view-transition-new(card-suite_3asecond) { animation-delay: 8ms; }',
  );
  expect(stagger?.textContent).toContain(
    '::view-transition-group(back2-suite_3asecond), ::view-transition-old(back2-suite_3asecond), ::view-transition-new(back2-suite_3asecond) { animation-delay: 8ms; }',
  );
  await Promise.resolve();
  expect(stagger?.isConnected).toBe(false);
  expect(document.querySelector('[style*="view-transition-name"]')).toBeNull();
}

describe('Feed transitions', () => {
  afterEach(tearDown);
  it('names live suite layers and nested columns while an outgoing shuffle clone is present', namesLiveLayers);
  it('moves paired rear sheets with their card when switching list and grid', synchronizesRearLayers);
});
