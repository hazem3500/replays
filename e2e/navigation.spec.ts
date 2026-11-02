import { expect, test } from '@playwright/test';

import { origin } from './support.ts';

test('opening a replay uses one page crossfade and one loading layout', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/replays/demo-shop', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(origin());
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const snapshots: Array<{ direction: string | undefined; layers: string[] }> = [];
    Object.assign(window, { navigationSnapshots: snapshots });
    document.startViewTransition = (update) =>
      start(async () => {
        if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
        await update();
        snapshots.push({
          direction: document.documentElement.dataset.pageTransition,
          layers: [...document.querySelectorAll('.app-shell, .app-shell *')]
            .map((element) => getComputedStyle(element).viewTransitionName)
            .filter((name) => name !== 'none'),
        });
      });
  });
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
  await expect(page.locator('main.skeleton-shell')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { navigationSnapshots: Array<{ direction: string | undefined; layers: string[] }> }).navigationSnapshots)).toEqual([
    { direction: 'page', layers: [] },
  ]);
  await expect(page.locator('.skeleton-overlay')).toHaveCount(0);
  release();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.locator('main.skeleton-shell, .skeleton-overlay')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
});

test('a decoded, compatible card poster morphs into the player and reverses to its source card', async ({ page }) => {
  await page.goto(origin());
  const cardLink = page.locator('a.row-target[href="/r/demo-shop"]').first();

  // Warm the viewer route once so this second navigation has a real player frame inside its update callback.
  await cardLink.click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await page.goBack();
  await expect(cardLink).toBeVisible();

  await cardLink.evaluate((link) => {
    const poster = link.closest('.feed-item')?.querySelector<HTMLElement>('.poster');
    if (!poster) throw new Error('Expected the linked card poster');
    const image = document.createElement('img');
    poster.append(image);
    poster.dataset.phase = 'ready';
    image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"%3E%3Crect width="1280" height="720" fill="%231a1e26"/%3E%3C/svg%3E';
  });
  await expect.poll(() => cardLink.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const snapshots: Array<{ hero: string[] }> = [];
    Object.assign(window, { heroSnapshots: snapshots });
    document.startViewTransition = (update) =>
      start(async () => {
        if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
        await update();
        snapshots.push({
          hero: [...document.querySelectorAll<HTMLElement>('.app-shell *')]
            .filter((element) => getComputedStyle(element).viewTransitionName === 'vt-hero')
            .map((element) => element.classList.contains('poster') ? 'poster' : element.className.toString()),
        });
      });
  });

  await cardLink.click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heroSnapshots: Array<{ hero: string[] }> }).heroSnapshots))
    .toEqual([{ hero: ['player-frame'] }]);
  await page.goBack();
  await expect(cardLink).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heroSnapshots: Array<{ hero: string[] }> }).heroSnapshots))
    .toHaveLength(2);
  const returnHero = await page.evaluate(() => (window as unknown as { heroSnapshots: Array<{ hero: string[] }> }).heroSnapshots[1]?.hero);
  expect(returnHero).toEqual(['poster']);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pageTransition)).toBeUndefined();
  expect(await page.locator('[style*="view-transition-name"]').count()).toBe(0);
});

test('touch open, All replays, and browser Back preserve the hero at 390px and 320px', async ({ browser }) => {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(origin());
      const cardLink = page.locator('a.row-target[href="/r/demo-shop"]').first();
      await cardLink.evaluate((link) => {
        const poster = link.closest('.feed-item')?.querySelector<HTMLElement>('.poster');
        if (!poster) throw new Error('Expected the linked card poster');
        const image = document.createElement('img');
        poster.append(image);
        poster.dataset.phase = 'ready';
        image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"%3E%3Crect width="1280" height="720" fill="%231a1e26"/%3E%3C/svg%3E';
      });
      await expect.poll(() => cardLink.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.evaluate(() => {
        const start = document.startViewTransition.bind(document);
        const pairs: string[][] = [];
        Object.assign(window, { phoneHeroPairs: pairs });
        document.startViewTransition = (update) => start(async () => {
          if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
          await update();
          pairs.push([...document.querySelectorAll<HTMLElement>('.app-shell *')]
            .filter((element) => getComputedStyle(element).viewTransitionName === 'vt-hero')
            .map((element) => element.classList.contains('poster') ? 'poster' : element.classList.contains('player-frame') ? 'player-frame' : element.classList.contains('sk-frame') ? 'sk-frame' : 'unknown'));
        });
      });

      await cardLink.tap();
      await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
      await page.getByRole('link', { name: 'All replays' }).tap();
      await expect(cardLink).toBeVisible();
      await cardLink.tap();
      await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
      await page.goBack();
      await expect(cardLink).toBeVisible();
      await expect(cardLink).not.toBeFocused();
      await expect.poll(() => page.evaluate(() => (window as unknown as { phoneHeroPairs: string[][] }).phoneHeroPairs.length)).toBeGreaterThanOrEqual(2);
      const pairs = await page.evaluate(() => (window as unknown as { phoneHeroPairs: string[][] }).phoneHeroPairs);
      expect(pairs.some((pair) => pair.includes('player-frame') || pair.includes('sk-frame'))).toBe(true);
      expect(pairs.filter((pair) => pair.includes('poster')).length).toBeGreaterThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(page.getByTestId('replay-player')).not.toBeFocused();
      await expect(page.getByTestId('replay-player')).toHaveCSS('box-shadow', 'none');
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pageTransition)).toBeUndefined();
      expect(await page.locator('[style*="view-transition-name"]').count()).toBe(0);
    } finally {
      await context.close();
    }
  }
});

test('a decoded portrait poster keeps the page crossfade instead of morphing into a landscape frame', async ({ page }) => {
  await page.goto(origin());
  const cardLink = page.locator('a.row-target[href="/r/demo-shop"]').first();
  await cardLink.click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await page.goBack();
  await expect(cardLink).toBeVisible();

  await cardLink.evaluate((link) => {
    const poster = link.closest('.feed-item')?.querySelector<HTMLElement>('.poster');
    if (!poster) throw new Error('Expected the linked card poster');
    const image = document.createElement('img');
    poster.append(image);
    poster.dataset.phase = 'ready';
    image.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="600"%3E%3Crect width="300" height="600" fill="%231a1e26"/%3E%3C/svg%3E';
  });
  await expect.poll(() => cardLink.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    const snapshots: Array<{ hero: string[] }> = [];
    Object.assign(window, { heroSnapshots: snapshots });
    document.startViewTransition = (update) =>
      start(async () => {
        if (typeof update !== 'function') throw new Error('Expected the page navigation update callback');
        await update();
        snapshots.push({
          hero: [...document.querySelectorAll<HTMLElement>('.app-shell *')]
            .filter((element) => getComputedStyle(element).viewTransitionName === 'vt-hero')
            .map((element) => element.className.toString()),
        });
      });
  });

  await cardLink.click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heroSnapshots: Array<{ hero: string[] }> }).heroSnapshots))
    .toEqual([{ hero: [] }]);
  expect(await page.locator('[style*="view-transition-name"]').count()).toBe(0);
});

test('reduced motion opens replay without starting a page transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin());
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

test('navigation stays functional when the View Transition API is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
  });
  await page.goto(origin());
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.dataset.pageTransition)).toBeUndefined();
  expect(await page.locator('[style*="view-transition-name"]').count()).toBe(0);
});

test('rapid open and Back cancels pending motion without stale names or page state', async ({ page }) => {
  await page.goto(origin());
  await page.locator('a.row-target[href="/r/demo-shop"]').first().click();
  await expect(page).toHaveURL(`${origin()}/r/demo-shop`);
  await page.goBack();
  await expect(page).toHaveURL(origin());
  await expect(page.locator('a.row-target[href="/r/demo-shop"]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.pageTransition)).toBeUndefined();
  expect(await page.locator('[style*="view-transition-name"]').count()).toBe(0);
});

test('touch navigation leaves the player stage unfocused and without a focus ring', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(origin());
    await page.locator('a.row-target[href="/r/demo-shop"]').first().tap();
    const stage = page.getByTestId('replay-player');
    await expect(stage.locator('iframe')).toBeAttached();
    await expect(stage).not.toBeFocused();
    await expect(stage).toHaveCSS('box-shadow', 'none');
  } finally {
    await context.close();
  }
});

test('keyboard navigation focuses the player stage with its visible focus ring', async ({ page }) => {
  await page.goto(origin());
  const cardLink = page.locator('a.row-target[href="/r/demo-shop"]').first();
  await cardLink.focus();
  await page.keyboard.press('Enter');
  const stage = page.getByTestId('replay-player');
  await expect(stage.locator('iframe')).toBeAttached();
  await expect(stage).toBeFocused();
  await expect(stage).toHaveCSS('box-shadow', /inset/);
  await page.keyboard.press('Tab');
  await page.goBack();
  await expect(cardLink).toBeVisible();
  await expect(cardLink).toBeFocused();
});

test('settings opens CLI guidance directly while the topbar owns theme changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin());
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Settings' });
  await expect(menu.getByRole('heading', { name: 'CLI & agent access' })).toBeVisible();
  await expect(menu.getByText('Color theme')).toHaveCount(0);
  await expect(menu.getByRole('tablist')).toHaveCount(0);
  await menu.getByRole('button', { name: 'Close settings' }).click();
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: `Switch to ${before === 'dark' ? 'light' : 'dark'} theme` }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});
