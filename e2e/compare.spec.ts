import { expect, type Page, test } from '@playwright/test';

import { boxOf, openReplay, origin } from './support.ts';

const compareUrl = (layout = 'grid') => `${origin()}/r/demo-shop?with=human-demo&layout=${layout}`;

async function titleOf(page: Page, id: string) {
  const body: unknown = await (await page.request.get(`${origin()}/api/replays/${id}`)).json();
  const meta = typeof body === 'object' && body !== null && 'meta' in body ? body.meta : undefined;
  const title = typeof meta === 'object' && meta !== null && 'title' in meta ? meta.title : undefined;
  if (typeof title !== 'string') throw new Error(`${id} has no title`);
  return title;
}

/** Tags every tile's iframe, so a remount (a new iframe) is visible afterwards. */
async function markPlayers(page: Page) {
  await expect(page.locator('.ct-tile iframe')).toHaveCount(2);
  await page.locator('.ct-tile iframe').evaluateAll((frames) => {
    for (const frame of frames) frame.setAttribute('data-marked', '');
  });
}

test('a replay compares with another in its own viewer, each tile under its own title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const tiles = page.getByTestId('compare-stage').locator('.ct-tile');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.nth(0).locator('.ct-name')).toHaveText(await titleOf(page, 'demo-shop'));
  await expect(tiles.nth(1).locator('.ct-name')).toHaveText(await titleOf(page, 'human-demo'));
  await expect(page.getByRole('group', { name: 'Playback controls' })).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Replay diagnostics' })).toBeVisible();
});

test('inspecting a tile scopes the title, inspector and URL to it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const own = await titleOf(page, 'demo-shop');
  const other = await titleOf(page, 'human-demo');
  await page.getByRole('button', { name: `Show ${other} in the panels` }).click();
  await expect(page).toHaveURL(/focus=human-demo/);
  await expect(page.getByRole('heading', { level: 1, name: other })).toBeVisible();
  // why: two long titles do not fit as segments, so the scope is one menu naming the recording on show.
  const scope = page.getByTestId('compare-scope');
  await expect(scope).toContainText(other);
  await scope.getByRole('button', { name: `Showing ${other}. Choose another recording` }).click();
  await page.getByRole('menuitemradio', { name: own }).click();
  await expect(page).not.toHaveURL(/focus=/);
});

test('layouts glide the same players: Grid, Spotlight and Single never remount a tile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await markPlayers(page);
  const layouts = page.getByTestId('layout-switch');
  await layouts.getByRole('radio', { name: 'Spotlight' }).click();
  await expect(page).toHaveURL(/layout=spotlight/);
  await expect(page.locator('.ct-tile[data-role="spotlight"]')).toHaveAttribute('data-tile-id', 'demo-shop');
  await layouts.getByRole('radio', { name: 'Single' }).click();
  await expect(page).not.toHaveURL(/layout=/);
  await expect(page.locator('.ct-tile[data-role="single"]')).toHaveCount(1);
  await layouts.getByRole('radio', { name: 'Grid' }).click();
  await expect(page.locator('.ct-tile[data-role="grid"]')).toHaveCount(2);
  await expect(page.locator('.ct-tile iframe[data-marked]')).toHaveCount(2);
});

test('the shared transport plays every recording from one clock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  await page.keyboard.press('k');
  await expect(page.getByTestId('playhead')).not.toHaveText('0:00.0');
  await page.keyboard.press('k');
  const paused = await page.getByTestId('playhead').textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('playhead')).toHaveText(paused ?? '');
});

test('the top bar’s Compare adds a recording, and Back returns to the replay alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, `${origin()}/r/demo-shop`);
  await expect(page.getByTestId('compare-with')).toHaveText('Compare');
  await page.getByTestId('compare-with').click();
  const picker = page.getByTestId('compare-picker');
  await picker.getByRole('button', { name: await titleOf(page, 'human-demo') }).click();
  await expect(page).toHaveURL(/\?with=human-demo&layout=grid$/);
  await expect(page.locator('.ct-tile')).toHaveCount(2);
  await page.goBack();
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
  await expect(page.getByTestId('compare-stage')).toHaveCount(0);
});

test('removing the added recording leaves the replay on its own', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const added = page.locator('.ct-tile[data-tile-id="human-demo"]');
  await added.hover();
  await added.getByTestId('tile-remove').click();
  await expect(page).not.toHaveURL(/with=/);
  await expect(page.getByTestId('replay-player').locator('iframe')).toBeAttached();
});

test('phones swipe through the compared recordings, the one in view in focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page, compareUrl());
  const stage = page.getByTestId('compare-stage');
  await expect(stage).toHaveAttribute('data-layout', 'carousel');
  await stage.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: 'instant' }));
  await expect(page).toHaveURL(/focus=human-demo/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // why: the phone top bar keeps its room for the title; the layout choice is in More.
  await expect(page.getByTestId('layout-switch')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByTestId('layout-single').click();
  await expect(page).not.toHaveURL(/layout=grid/);
});

test('tile actions stay quiet until the pointer rests on a tile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const actions = page.locator('.ct-tile[data-tile-id="human-demo"] .ct-actions');
  await expect(actions).toHaveCSS('opacity', '0');
  await page.locator('.ct-tile[data-tile-id="human-demo"]').hover();
  await expect(actions).toHaveCSS('opacity', '1');
});

/** Every tile on show lies inside the stage, and the stage ends where the steps rail begins. */
async function tilesClearOfTheRail(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="compare-stage"]')?.getBoundingClientRect();
    const rail = document.querySelector('.timeline-panel')?.getBoundingClientRect();
    if (!stage || !rail) return false;
    const tiles = [...document.querySelectorAll('.ct-tile:not([data-role="hidden"])')].map((tile) => tile.getBoundingClientRect());
    return stage.right <= rail.left + 1 && tiles.every((tile) => tile.left >= stage.left - 1 && tile.right <= stage.right + 1);
  });
}

test('tiles stay inside the stage, clear of the steps rail, at every width and layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl());
  const layouts = page.getByTestId('layout-switch');
  for (const width of [1280, 1040, 880]) {
    await page.setViewportSize({ width, height: 800 });
    for (const layout of ['Spotlight', 'Grid']) {
      await layouts.getByRole('radio', { name: layout }).click();
      await expect.poll(() => tilesClearOfTheRail(page)).toBe(true);
    }
  }
});

/** Each tile's own playhead (ms, to the tenth of a second), in tile order. */
async function tileTimes(page: Page) {
  return page.locator('.ct-picture').evaluateAll((pictures) => pictures.map((picture) => Number(picture.getAttribute('data-time') ?? -1)));
}

for (const [layout, viewport] of [
  ['spotlight', { width: 1280, height: 800 }],
  ['grid', { width: 390, height: 844 }],
] as const) {
  test(`Play drives every tile on one clock (${layout}, ${viewport.width} px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openReplay(page, compareUrl(layout));
    await expect(page.locator('.ct-picture[data-time]')).toHaveCount(2);
    const before = await tileTimes(page);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(async () => (await tileTimes(page)).every((time, index) => time > (before[index] ?? 0) + 500)).toBe(true);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const [a = 0, b = 0] = await tileTimes(page);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(300);
  });
}

test('a seek lands every tile on the same moment', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl('spotlight'));
  const seek = page.getByRole('slider', { name: 'Seek' });
  const box = await boxOf(seek);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
  await expect
    .poll(async () => {
      const [a = -1, b = -2] = await tileTimes(page);
      return a > 0 && Math.abs(a - b) <= 200;
    })
    .toBe(true);
});

test('dragging the seek bar moves every tile during the drag, not only on release', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openReplay(page, compareUrl('spotlight'));
  const box = await boxOf(page.getByRole('slider', { name: 'Seek' }));
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  const start = await tileTimes(page);
  const during: number[][] = [];
  for (const share of [0.25, 0.4, 0.55]) {
    await page.mouse.move(box.x + box.width * share, y, { steps: 4 });
    await page.waitForTimeout(120);
    during.push(await tileTimes(page));
  }
  // why: read while the pointer is still down; a tile that only catches up on release fails here.
  expect(during.every((times) => times.every((time, index) => time !== start[index]))).toBe(true);
  await page.mouse.up();
});
