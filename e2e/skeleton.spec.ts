import { expect, type Page, test } from '@playwright/test';

import { origin } from './support.ts';

/**
 * The viewer skeleton (ViewerSkeleton.tsx): layout-exact with the loaded viewer (no shift), invisible for fast
 * loads, a progress hint after 1.2 s, and static under reduced motion.
 */
const viewer = () => `${origin()}/r/demo-shop`;

const KEY_ELEMENTS = ['.app-topbar', '.player-stage', '.transport', '.timeline-panel', '.inspector', '.inspector-navigation-tabs'];

/** Holds the bundle request until `release` is called. */
async function holdBundle(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/replays\/[^/?]+$/, async (route) => {
    await gate;
    await route.continue();
  });
  return () => release();
}

async function rects(page: Page, selectors: string[]) {
  return page.evaluate((list) => {
    const out: Record<string, number[] | null> = {};
    for (const selector of list) {
      const element = document.querySelector(`#root ${selector}`);
      const box = element?.getBoundingClientRect();
      out[selector] = box ? [box.x, box.y, box.width, box.height] : null;
    }
    return out;
  }, selectors);
}

function expectSameLayout(before: Record<string, number[] | null>, after: Record<string, number[] | null>) {
  for (const [selector, box] of Object.entries(after)) {
    if (!box) continue;
    const was = before[selector];
    expect(was, `${selector} is in the skeleton`).not.toBeNull();
    for (const [index, value] of box.entries()) expect(Math.abs(value - was![index]!), `${selector}[${index}]`).toBeLessThanOrEqual(2);
  }
}

for (const [label, viewport, mobile] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 800 }, true],
] as const) {
  test(`${label}: the skeleton has the loaded viewer's layout (no shift)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const release = await holdBundle(page);
    await page.goto(viewer());
    const skeleton = page.locator('main.skeleton-shell');
    await expect(skeleton).toHaveCSS('opacity', '1');
    const selectors = mobile ? ['.app-topbar', '.player-stage'] : KEY_ELEMENTS;
    const before = await rects(page, selectors);
    release();
    await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
    await expect(page.locator('.skeleton-overlay')).toHaveCount(0);
    expectSameLayout(before, await rects(page, selectors));
    await context.close();
  });
}

test('after 1.2 s still loading, a thin progress line shows under the top bar', async ({ page }) => {
  const release = await holdBundle(page);
  await page.goto(viewer());
  const line = page.locator('main.skeleton-shell .sk-progress');
  await expect(line).toBeAttached();
  const opacity = () => line.evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(await opacity()).toBeLessThan(0.1);
  await expect(line).toHaveAttribute('data-visible', 'true');
  await expect.poll(opacity, { timeout: 8_000 }).toBe(1);
  release();
});

test('under reduced motion the loading trace is static', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const release = await holdBundle(page);
  await page.goto(viewer());
  const trace = page.locator('main.skeleton-shell .sk-progress > span');
  await expect(trace).toBeAttached();
  await expect(page.locator('main.skeleton-shell .sk-progress')).toHaveAttribute('data-visible', 'true');
  expect(await trace.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  release();
  await context.close();
});

for (const folded of [false, true]) {
  test(`cold phone link without a hint keeps an aspect-sized frame (inspector ${folded ? 'folded' : 'unfolded'})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript((isFolded) => {
      sessionStorage.removeItem('replays-open-hint');
      localStorage.removeItem('replays-open-hint');
      if (isFolded) localStorage.setItem('replays-inspector-collapsed', '1');
      else localStorage.removeItem('replays-inspector-collapsed');
    }, folded);
    const release = await holdBundle(page);
    await page.goto(viewer());
    const shell = page.locator('main.skeleton-shell');
    await expect(shell).toHaveAttribute('aria-busy', 'true');
    if (folded) await expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    else await expect(shell).not.toHaveAttribute('data-inspector-collapsed', 'true');
    await expect(shell.locator('.sk-poster')).toHaveCount(0);
    await expect(shell.locator('.sk-play')).toBeVisible();
    const geometry = await shell.locator('.sk-frame').evaluate((element) => {
      const frame = element.getBoundingClientRect();
      const stage = element.closest('.player-stage')!.getBoundingClientRect();
      return {
        frame: [frame.x, frame.y, frame.width, frame.height] as const,
        stage: [stage.x, stage.y, stage.width, stage.height] as const,
      };
    });
    expect(geometry.frame[2]).toBeGreaterThan(geometry.stage[2] * 0.65);
    expect(geometry.frame[3]).toBeGreaterThan(100);
    expect(Math.abs(geometry.frame[0] + geometry.frame[2] / 2 - (geometry.stage[0] + geometry.stage[2] / 2))).toBeLessThanOrEqual(2);
    expect(geometry.frame[2]! / geometry.frame[3]!).toBeCloseTo(1.6, 1);
    release();
  });
}

test('a stale substring hint does not apply to a different replay id', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'replays-open-hint',
      JSON.stringify({ id: 'demo', title: 'Wrong replay', poster: '/wrong-poster.png', viewport: { width: 900, height: 900 } }),
    );
  });
  const release = await holdBundle(page);
  await page.goto(viewer());
  const shell = page.locator('main.skeleton-shell');
  await expect(shell.locator('.sk-poster')).toHaveCount(0);
  await expect(shell.locator('.sk-play')).toBeVisible();
  expect(await shell.locator('.sk-frame').evaluate((element) => getComputedStyle(element).aspectRatio)).toBe('1.6 / 1');
  release();
});

test('a failed opening poster falls back without a broken image glyph', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'replays-open-hint',
      JSON.stringify({ id: 'demo-shop', viewport: { width: 1440, height: 900 }, poster: '/failed-poster.png' }),
    );
  });
  await page.route('**/failed-poster.png', (route) => route.abort());
  const failedPoster = page.waitForEvent('requestfailed', (request) => request.url().endsWith('/failed-poster.png'));
  const release = await holdBundle(page);
  await page.goto(viewer());
  const shell = page.locator('main.skeleton-shell');
  await failedPoster;
  await expect(shell.locator('.sk-poster')).toHaveCount(0);
  await expect(shell.locator('.sk-play')).toBeVisible();
  release();
});

test('a suite opens on a skeleton with its runs sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route(/\/api\/suites\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(`${origin()}/s/no-such-suite`);
  await expect(page.locator('.suite-sidebar').first()).toBeVisible();
  await expect(page.locator('main.skeleton-shell').first()).toBeVisible();
});
