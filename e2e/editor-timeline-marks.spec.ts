import { expect, type Page, test } from '@playwright/test';

import { boxOf, cloneBundle, postBundle, serveApp, uniqueId } from './support.ts';

const server = serveApp({ REPLAYS_BETA_EDITOR: 'true' });
const base = () => server().origin;

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

const STEPS = [
  { at: 2_000, kind: 'click', label: 'Open the cart' },
  { at: 4_000, kind: 'fill', label: 'Enter an email address' },
  { at: 7_000, kind: 'click', label: 'Place the order' },
];

/** demo-shop with three steps far enough apart to stay three dots, and `edits` saved before the editor opens. */
async function openEditor(page: Page, { steps = STEPS, ...edits }: Record<string, unknown> & { steps?: unknown[] } = {}) {
  const id = uniqueId('marks');
  const bundle = await cloneBundle(page.request, base(), 'demo-shop', id);
  await postBundle(page.request, base(), { ...bundle, steps });
  const saved = await page.request.put(`${base()}/api/replays/${id}/edits`, {
    headers: { origin: base(), 'if-match': '"e.none"' },
    data: { version: 1, cuts: [], ...edits },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`${base()}/r/${id}/edit`);
  await expect(page.getByTestId('timeline')).toHaveAttribute('data-ready', 'true');
}

const tooltip = (page: Page) => page.locator('[data-slot="tooltip-content"]');

/** Whether a press just inside each edge of `element` lands on it rather than on something over or under it. */
function edgesHit(element: Element) {
  const { left, top, width, height } = element.getBoundingClientRect();
  const points = [
    [left + 1, top + height / 2],
    [left + width - 1, top + height / 2],
    [left + width / 2, top + 1],
    [left + width / 2, top + height - 1],
  ] as const;
  return points.map(([x, y]) => element.contains(document.elementFromPoint(x, y)));
}

test.describe('editor timeline step dots', () => {
  test('a step dot names its step on hover and seeks there on click', async ({ page }) => {
    await openEditor(page);
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots).toHaveCount(3);
    const target = await dots.nth(2).boundingBox();
    expect(Math.min(target?.width ?? 0, target?.height ?? 0)).toBeGreaterThanOrEqual(24);
    await dots.nth(2).hover();
    await expect(tooltip(page)).toContainText('Place the order');
    await dots.nth(2).click();
    await expect(page.getByTestId('editor-clock')).toHaveText('0:07.0');
  });

  test('the step dots are one tab stop whose arrows move between steps and whose Enter seeks', async ({ page }) => {
    await openEditor(page);
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(dots.nth(1)).toHaveAttribute('tabindex', '-1');
    await dots.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dots.nth(1)).toBeFocused();
    await expect(tooltip(page)).toContainText('Enter an email address');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-clock')).toHaveText('0:04.0');
  });

  test('a filled dot names its action and time, a hollow one its wait and what it follows, and a load wait has none', async ({ page }) => {
    const steps = [
      ...STEPS,
      { at: 7_400, kind: 'wait', label: 'Wait for the page' },
      { at: 8_000, kind: 'wait', label: 'Read the receipt' },
    ];
    await openEditor(page, { steps });
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots).toHaveCount(4);
    await dots.nth(0).hover();
    await expect(tooltip(page)).toContainText('Click, 0:02.0');
    await dots.nth(3).hover();
    await expect(tooltip(page)).toContainText(/Wait, \d+\.\d\s+s, after Place the order/);
    await expect(dots.nth(3)).toHaveAccessibleName(/^Wait of \d+\.\d seconds after Place the order, from 0:08\.0$/);
  });

  test('each dot takes a press anywhere on its 24 px target, never the ruler under it', async ({ page }) => {
    await openEditor(page);
    const dot = page.getByRole('group', { name: 'Steps' }).getByRole('button').nth(1);
    const box = await dot.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(24);
    const hits = await dot.evaluate(edgesHit);
    expect(hits).toEqual([true, true, true, true]);
  });

  test('the clip names each step quietly in whole words, never part of one', async ({ page }) => {
    await openEditor(page);
    const labels = await page.getByTestId('clip-step').allTextContents();
    expect(labels).toHaveLength(STEPS.length);
    for (const [index, step] of STEPS.entries()) {
      const shown = labels[index] ?? '';
      expect(shown).not.toBe('');
      expect(`${step.label} `.startsWith(`${shown} `)).toBe(true);
    }
  });

  test('a step dot under a cut dims, and the clip draws no icons', async ({ page }) => {
    await openEditor(page, { cuts: [{ id: 'cut-1', from: 1_000, to: 5_000 }] });
    const dots = page.getByRole('group', { name: 'Steps' }).getByRole('button');
    await expect(dots.nth(1)).toHaveAttribute('data-removed', 'true');
    await expect(dots.nth(2)).not.toHaveAttribute('data-removed');
    await expect(page.locator('.tl-clip svg')).toHaveCount(0);
  });
});

test.describe('editor timeline lanes', () => {
  test('the dock grows to hold every effect lane at 1280 by 800, so none is clipped', async ({ page }) => {
    await openEditor(page, {
      zooms: [{ id: 'zoom-1', from: 500, to: 2_000, scale: 1.8 }],
      speeds: [{ id: 'speed-1', from: 2_500, to: 4_000, rate: 4 }],
      blurs: [{ id: 'blur-1', from: 1_000, to: 3_000, x: 0.3, y: 0.3, width: 0.2, height: 0.2 }],
      captions: [{ id: 'caption-1', from: 4_500, to: 6_000, text: 'Pay' }],
    });
    const timeline = await boxOf(page.getByTestId('timeline'));
    for (const kind of ['zoom', 'speed', 'blur', 'caption']) {
      const lane = await boxOf(page.getByTestId(`lane-${kind}`));
      // why: 40 px is a lane's resting height; a dock that did not grow would squash the lanes towards 30 or clip them.
      expect(lane.height, kind).toBeGreaterThanOrEqual(38);
      expect(lane.y + lane.height, kind).toBeLessThanOrEqual(timeline.y + timeline.height);
    }
  });
});

test.describe('editor tools and Add menu', () => {
  test('the tools show their keys, and the Add menu names each item briefly and says what it does on its last line', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('add-cut').locator('.editor-key')).toHaveText('C');
    await expect(page.getByTestId('add-point-highlight').locator('.editor-key')).toHaveText('M');
    await page.getByTestId('add-effect').click();
    const menu = page.getByRole('menu', { name: 'Add to timeline' });
    await expect(menu.getByRole('menuitem')).toHaveText(['ZoomZ', 'Speed upF', 'BlurB', 'CaptionsT']);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    await menu.getByRole('menuitem', { name: 'Zoom' }).hover();
    await expect(page.getByTestId('add-hint')).toHaveText('Zoom in on every click');
    await expect(menu.getByRole('menuitem', { name: 'Zoom' })).toHaveAccessibleDescription('Zoom in on every click');
  });

  test('the Add menu keeps its size while its hint line changes with the item under the pointer', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('add-effect').click();
    const menu = page.getByRole('menu', { name: 'Add to timeline' });
    const hint = page.getByTestId('add-hint');
    // why: the menu scales in as it opens; its resting size is the one after that.
    await menu.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const resting = await boxOf(menu);
    const fits = () => hint.evaluate((element) => element.scrollHeight <= element.clientHeight);
    expect(await fits()).toBe(true);
    for (const item of await menu.getByRole('menuitem').all()) {
      await item.hover();
      await expect(hint).not.toHaveText('Adds at the playhead, or over the selection');
      expect(await boxOf(menu)).toEqual(resting);
      expect(await fits()).toBe(true);
    }
    await expect(page.getByTestId('lane-invitation')).toHaveCount(0);
  });
});
