import { type CDPSession, expect, type Page, test } from '@playwright/test';

import { openReplay, origin, gotoHydrated } from './support.ts';

/**
 * Phones, end to end, with real touch input (isMobile + hasTouch; taps and CDP touch drags, never a mouse):
 * the viewer's app shell, the panel fold, captions, copy link (tap and long press), the topbar at 360 px, and
 * the index.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });

const viewer = () => `${origin()}/r/demo-shop`;

async function noPageScroll(page: Page) {
  const scroll = await page.evaluate(() => ({
    height: document.scrollingElement!.scrollHeight - innerHeight,
    width: document.scrollingElement!.scrollWidth - innerWidth,
    top: document.scrollingElement!.scrollTop,
  }));
  expect(scroll).toEqual({ height: 0, width: 0, top: 0 });
}

async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    });
  }
}

test('the index is a list of whole-row links without sideways scroll', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/`);
  await expect(page.getByRole('link', { name: /^Demo shop/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('link', { name: /^Demo shop/ }).tap();
  await expect(page).toHaveURL(/\/r\/demo-shop$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Demo shop/ })).toBeVisible();
});

test('the search grows from its icon across the row, finds a replay and closes by touch', async ({ page }) => {
  await gotoHydrated(page, `${origin()}/`);
  const search = page.getByRole('combobox', { name: 'Search replays' });
  const slot = page.locator('.command-search');
  const rest = (await slot.boundingBox())!;
  expect(rest.width).toBe(40);
  await slot.tap();
  await expect(search).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toBeHidden();
  await search.fill('signup');
  const results = page.getByRole('listbox', { name: 'Quick results' });
  await expect(results.getByRole('option', { name: /^Demo signup form/ })).toBeVisible();
  const row = page.viewportSize()!.width;
  const field = (await results.boundingBox())!;
  expect(field.width).toBeGreaterThan(row * 0.85);
  await page.getByRole('button', { name: 'Close search' }).tap();
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await slot.boundingBox())!.x).toBe(rest.x);
});

test('open, play, scrub by touch, switch tabs, fold and unfold the panel', async ({ page, context }) => {
  await openReplay(page, viewer());
  await noPageScroll(page);
  await page.getByRole('button', { name: 'Play', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).tap();

  // A touch drag on the 40 px strip scrubs; the bubble names the step under the finger (no hover on touch).
  const seek = (await page.getByRole('slider', { name: 'Seek' }).boundingBox())!;
  expect(seek.height).toBeGreaterThanOrEqual(40);
  const y = seek.y + seek.height / 2;
  const cdp = await context.newCDPSession(page);
  await touchDrag(cdp, { x: seek.x + seek.width * 0.1, y }, { x: seek.x + seek.width * 0.7, y: y - 6 });
  await expect(page.getByTestId('scrubber-bubble')).toHaveAttribute('data-visible', 'true');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  await noPageScroll(page);

  // On phones Steps is the first tab of the panel.
  await expect(page.getByTestId('steps-tab')).toBeVisible();
  await page.getByTestId('network-tab').tap();
  await expect(page.getByTestId('network-tab')).toHaveAttribute('aria-selected', 'true');

  // One fold model, as on desktop: the chevron folds the panel to its tab row and the player grows.
  const stageOpen = (await page.getByTestId('replay-player').boundingBox())!.height;
  const fold = page.getByTestId('inspector-collapse');
  await expect(fold).toHaveAccessibleName('Collapse panel');
  await fold.tap();
  await expect(fold).toHaveAccessibleName('Expand panel');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await page.getByTestId('replay-player').boundingBox())!.height).toBeGreaterThan(stageOpen + 100);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeInViewport({ ratio: 1 });
  await noPageScroll(page);
  // Remembered across visits.
  await page.reload();
  await expect(page.getByTestId('inspector-collapse')).toHaveAccessibleName('Expand panel');
  // A tab tap while folded opens the panel on that tab.
  await page.getByTestId('console-tab').tap();
  await expect(page.getByTestId('inspector-collapse')).toHaveAccessibleName('Collapse panel');
  await expect(page.getByTestId('console-tab')).toHaveAttribute('aria-selected', 'true');
});

test('the steps tab lists the steps and a tap seeks', async ({ page }) => {
  await openReplay(page, viewer());
  await page.getByTestId('steps-tab').tap();
  // The rows rise in with a stagger; tap once they have settled, or the tap lands on a moving row.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-testid="step-timeline"] .step')].every((row) => row.getAnimations().length === 0),
  );
  await page.getByRole('button', { name: /^Step 5 of 18, / }).tap();
  await expect(page.locator('[data-step-index="4"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('playhead')).toHaveText(/^0:0[23]\.\d$/);
});

test('copy link lives in More on phones: the plain link, and the link at this moment', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openReplay(page, viewer());
  const header = page.locator('header.app-topbar');
  await header.getByRole('button', { name: 'More actions' }).tap();
  await page.getByTestId('copy-link').tap();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText('Link copied');
  await header.getByRole('button', { name: 'More actions' }).tap();
  await page.getByRole('menuitem', { name: 'Copy link at this moment' }).tap();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /^Link at / })).toBeVisible();
});

test('the topbar fits at 320 px: the title keeps its room beside Edit and More; no tooltips on touch', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openReplay(page, viewer());
  await noPageScroll(page);
  const header = page.locator('header.app-topbar');
  const headerBox = (await header.boundingBox())!;
  for (const button of await header.locator('a, button').all()) {
    const box = await button.boundingBox();
    if (!box || box.width < 2) continue;
    expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 0.5);
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
  // why: details, copy link and Compare moved into More, so the title is never squeezed to a letter.
  expect((await page.locator('#replay-title').boundingBox())!.width).toBeGreaterThanOrEqual(120);
  await expect(header.getByRole('button', { name: 'Replay details' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: /^Switch to (light|dark) theme$/ })).toHaveCount(0);

  // A tap on an icon button never leaves a tooltip behind.
  await header.getByRole('button', { name: 'More actions' }).tap();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await expect(page.getByTestId('theme-menu-item')).toBeVisible();

  // Replay details is a bottom sheet headed by the full title (the bar cuts it).
  await page.getByTestId('replay-details').tap();
  const sheet = page.getByTestId('replay-info');
  await expect(sheet).toBeVisible();
  const title = await sheet.getByRole('heading').innerText();
  await expect(page.locator('#replay-title')).toHaveAccessibleName(title);
});
