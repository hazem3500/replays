import { expect, test } from '@playwright/test';

import { expectSuiteHandoff, type HandoffCapture, hoverSuiteCard } from './suite-handoff.ts';
import { origin, gotoHydrated, serveApp } from './support.ts';
import { deferred } from '../src/client/lib/deferred.ts';

test.describe('server-rendered index', () => {
  const server = serveApp({ REPLAYS_SSR: '1' });
  test('the list is visible when JavaScript is disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto(server().origin);
      await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('the library hydrates in a different locale and time zone before showing local dates', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Pacific/Auckland' });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await gotoHydrated(page, server().origin);
      if (!response) throw new Error('The server-rendered library must return an HTML response');
      const times = await page.evaluate(
        (html) => {
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const row = parsed.querySelector('a.row-target[href="/r/demo-shop"]')?.closest('li');
          const time = row?.querySelector('time');
          if (!time?.dateTime) throw new Error('The server must render the sample recording date');
          const date = new Date(time.dateTime);
          const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
          if (date.getUTCFullYear() !== new Date().getUTCFullYear()) options.year = 'numeric';
          return {
            rendered: time.textContent,
            utc: new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(date).replace(/[\u00a0\u202f]/g, ' '),
            local: new Intl.DateTimeFormat(undefined, options).format(date).replace(/[\u00a0\u202f]/g, ' '),
          };
        },
        await response.text(),
      );
      expect(times.rendered).toBe(times.utc);
      expect(times.local).not.toBe(times.utc);
      const time = page.locator('a.row-target[href="/r/demo-shop"]').locator('xpath=ancestor::li').locator('time').first();
      await expect(time).toHaveText(times.local);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const scenario of [
    { name: 'a cold suite captures a ready frame or uses its bounded fade fallback', warm: false, decodeDelay: 0 },
    { name: 'a warm suite waits for its decoded cover before the thumbnail handoff', warm: true, decodeDelay: 150 },
  ])
    test(scenario.name, async ({ page }) => {
      const link = await hoverSuiteCard(page, server().origin, scenario.warm);
      await page.evaluate(watchCoverDecode, scenario.decodeDelay);
      await page.evaluate(captureHandoff);
      await link.click();
      await expect(page.getByTestId('compare-stage')).toBeVisible();
      await expect(page.locator('.ct-tile[data-current] iframe')).toBeAttached();
      await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
      await expectSuiteHandoff(page, scenario.warm);
    });
});

test('a direct replay visit loads the index interface only when returning home', async ({ page }) => {
  const indexRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/ReplayIndex-[^/]+\.js/.test(request.url())) indexRequests.push(request.url());
  });
  await gotoHydrated(page, `${origin()}/r/demo-shop`);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  expect(indexRequests).toEqual([]);
  await page.getByRole('link', { name: 'All replays', exact: true }).click();
  await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
  expect(indexRequests).toHaveLength(1);
});

test('the library header keeps search and actions in one compact row', async ({ page }) => {
  await page.setViewportSize({ width: 1026, height: 800 });
  await gotoHydrated(page, origin());
  const header = page.locator('.index-head > .topbar');
  await expect(header).toHaveCSS('display', 'flex');
  const box = await header.boundingBox();
  expect(box?.height).toBeLessThan(70);
  const search = header.getByRole('combobox');
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('the index downloads the player only after row intent', async ({ page }) => {
  const playerRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/(?:Viewer|player)-[^/]+\.js/.test(request.url())) playerRequests.push(request.url());
  });
  await gotoHydrated(page, origin());
  await page.waitForTimeout(4500);
  expect(playerRequests).toEqual([]);
  await page.locator('a.row-target[href="/r/demo-shop"]').first().hover();
  await expect.poll(() => playerRequests.length).toBeGreaterThan(0);
});

test('a thumbnail morphs into the loading frame and returns to the same card on Back', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/replays/demo-shop', async (route) => {
    await gate;
    await route.continue();
  });
  await page.route('**/api/replays/demo-shop/poster?*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#eee"/></svg>',
    }),
  );
  await gotoHydrated(page, origin());
  const link = page.locator('a.row-target[href="/r/demo-shop"]').first();
  await link.hover();
  const poster = link.locator('xpath=ancestor::li').locator('.poster > img').first();
  await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(recordHeroTransitions);
  await link.click();
  await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
  await expect(page.locator('main.skeleton-shell')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'navigationSnapshots') as unknown))
    .toEqual([{ hero: 'to-viewer', before: ['IMG'], after: ['DIV'] }]);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'navigationCaptures') as unknown))
    .toMatchObject([{ geometry: true, corners: true, finishedBeforeSetup: false, unfinishedAtFinish: 0 }]);
  await expect(page.locator('.skeleton-overlay')).toHaveCount(0);
  release();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.locator('main.skeleton-shell, .skeleton-overlay')).toHaveCount(0);
  await page.goBack();
  await expect(link).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'navigationSnapshots') as unknown))
    .toEqual([
      { hero: 'to-viewer', before: ['IMG'], after: ['DIV'] },
      { hero: 'to-index', before: ['DIV'], after: ['IMG'] },
    ]);
});

test('reduced motion opens replay without starting a page transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, origin());
  await page.evaluate(() => {
    document.startViewTransition = () => {
      throw new Error('Reduced motion must not start a view transition');
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  expect(errors).toEqual([]);
});

test('Back during an opening transition leaves navigation and the next player usable', async ({ page }) => {
  const { promise: pending, resolve: release } = deferred();
  await page.route('**/api/replays/demo-shop', async (route) => {
    await pending;
    await route.continue();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await gotoHydrated(page, origin());
    const link = page.locator('a.row-target[href="/r/demo-shop"]').first();
    await link.click();
    await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
    await page.goBack();
    await expect(link).toBeVisible();
    release();
    await link.click();
    await expect(page.getByTestId('replay-player').locator('iframe')).toHaveCount(1);
    await expect(page.locator('html')).not.toHaveAttribute('data-page-transition', /.+/);
    await expect(page.locator('[style*="view-transition-name: vt-page-hero"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('settings opens a dialog of sections without its own theme buttons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoHydrated(page, origin());
  const trigger = page.getByRole('button', { name: 'Settings', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'CLI & agents' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: /^(Light|Dark)$/ })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await expect(dialog.getByRole('tabpanel')).toContainText('Play or pause');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

/** In the page: records the hero's snapshot names and whether its morph animates geometry and corners; delays the first setup. */
function recordHeroTransitions() {
  const start = document.startViewTransition.bind(document);
  const snapshots: Array<{ hero: string | undefined; before: string[]; after: string[] }> = [];
  type Capture = {
    geometry: boolean;
    corners: boolean;
    prepared: boolean;
    finishedBeforeSetup: boolean;
    unfinishedAtFinish: number | null;
  };
  const captures: Capture[] = [];
  let delayed = false;
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: page.evaluate serializes this browser boundary without module-level helpers.
  const named = (root: Document) =>
    [...root.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]
      .filter((element) => element.style.viewTransitionName === 'vt-page-hero')
      .map((element) => element.tagName);
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- why: this callback is serialized into the browser boundary.
  const heroAnimations = (root: Document) =>
    root
      .getAnimations()
      .filter((animation) => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement?.includes('(vt-page-hero)'));
  Object.assign(window, { navigationSnapshots: snapshots, navigationCaptures: captures });
  document.startViewTransition = (update) => {
    const before = named(document);
    const capture: Capture = { geometry: false, corners: false, prepared: false, finishedBeforeSetup: false, unfinishedAtFinish: null };
    captures.push(capture);
    const transition = start(async () => {
      if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
      await update();
      snapshots.push({
        hero: document.documentElement.dataset.pageHero,
        before,
        after: named(document),
      });
    });
    if (before.length && !delayed) {
      delayed = true;
      // why: reproduce slow post-capture setup without mocking Motion or blocking the browser's animation clock.
      const ready = transition.ready.then(() => new Promise<void>((resolve) => window.setTimeout(resolve, 350)));
      Object.defineProperty(transition, 'ready', { value: ready });
    }
    void transition.ready.then(() =>
      setTimeout(() => {
        const frames = heroAnimations(document).flatMap((animation) =>
          animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes() : [],
        );
        capture.geometry =
          frames.some((frame) => 'transform' in frame) && frames.every((frame) => !('width' in frame || 'height' in frame));
        capture.corners = frames.some((frame) => 'borderTopLeftRadius' in frame);
        capture.prepared = true;
      }, 0),
    );
    void transition.finished.then(() => {
      capture.finishedBeforeSetup = !capture.prepared;
      capture.unfinishedAtFinish = heroAnimations(document).filter(
        (animation) => animation.playState !== 'finished' && animation.playState !== 'idle',
      ).length;
    });
    return transition;
  };
}

/** In the page: slows and records comparison cover decodes, and logs the focused tile's phase and size as it changes. */
function watchCoverDecode(decodeDelay: number) {
  const decode = HTMLImageElement.prototype.decode;
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
    const started = window.coldSuiteStarted ?? 0;
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
function captureHandoff() {
  const start = document.startViewTransition.bind(document);
  const decoded = window.coldSuiteDecoded ?? new WeakSet<HTMLImageElement>();
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
