import { expect, type Page, test } from '@playwright/test';

import { origin } from './support.ts';

/**
 * The viewer skeleton (ViewerSkeleton.tsx): layout-exact with the loaded viewer (no shift), invisible for fast
 * loads, a progress hint after 1.2 s, and static under reduced motion.
 */
const viewer = () => `${origin()}/r/demo-shop`;

const KEY_ELEMENTS = ['.app-topbar', '.player-stage', '.transport', '.timeline-panel', '.inspector', '.inspector-tabs'];

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
    const selectors = mobile ? KEY_ELEMENTS.filter((selector) => selector !== '.timeline-panel') : KEY_ELEMENTS;
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

test('under reduced motion loading is static: the viewer’s parts wait without pulsing', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const release = await holdBundle(page);
  await page.goto(viewer());
  const block = page.locator('main.skeleton-shell');
  await expect(block).toBeAttached();
  await expect(block.getByRole('status')).toHaveText('Loading replay…');
  // why: the bar's controls are the viewer's own, disabled until it is there, never live fakes; More stays live for the theme.
  await expect(block.locator('header button:not(:disabled)')).toHaveCount(1);
  await expect(block.getByRole('button', { name: 'More actions' })).toBeEnabled();
  const animations = await block.evaluate(
    (element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
  );
  expect(animations).toBe(0);
  const line = block.locator('.sk-progress');
  await expect(line).toHaveAttribute('data-visible', 'true');
  await expect(line).toHaveCSS('opacity', '1');
  release();
  await context.close();
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
